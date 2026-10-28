import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { runtimeDir, gatewayRoot, readEnv, workerEnv } from './runtime.mjs';

test('real Docker retirement survives restart, retries deletion failure and preserves active, previous and unrelated containers', { skip: !process.env.E2E_RUNTIME_DIR, timeout: 120000 }, async () => {
    const e = await readEnv();
    const env = workerEnv(e);
    const { createDockerEngineClient } = await import(pathToFileURL(`${gatewayRoot}/packages/worker/dist/docker-client.js`));
    const { createDockerCandidateAdapter } = await import(pathToFileURL(`${gatewayRoot}/packages/worker/dist/docker.js`));
    const proxySocket = `/tmp/cms-gc-${randomUUID()}.sock`;
    const list = () => execFileSync('docker', ['ps', '-aq', '--no-trunc'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    function home() {
        return new Promise((resolve, reject) => http.get('http://127.0.0.1:18090/', { headers: { host: 'shop.localhost' } }, res => {
            res.resume(); res.on('end', () => resolve(res.statusCode));
        }).on('error', reject));
    }
    async function until(check) {
        for (let n = 0; n < 150; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
        assert.fail('retirement condition timed out');
    }
    async function stop() {
        const pid = Number(await readFile(`${runtimeDir}/worker.pid`, 'utf8'));
        const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
        assert.ok(command.includes(`${gatewayRoot}/packages/worker/dist/index.js`), 'refuse to stop an unrelated process');
        process.kill(pid, 'SIGTERM');
        await until(async () => { try { await home(); return false; } catch { return true; } });
    }
    async function start(socketPath) {
        const log = await open(`${runtimeDir}/worker-retirement.log`, 'a', 0o600);
        const child = spawn(process.execPath, [`${gatewayRoot}/packages/worker/dist/index.js`], {
            cwd: gatewayRoot, detached: true, stdio: ['ignore', log.fd, log.fd], env: { ...env, DOCKER_SOCKET_PATH: socketPath },
        });
        child.unref(); await log.close();
        await writeFile(`${runtimeDir}/worker.pid`, String(child.pid));
        await until(async () => { try { return await home() === 200; } catch { return false; } });
    }
    const state = JSON.parse(await readFile(`${runtimeDir}/gateway-routes.json`, 'utf8'));
    const active = state.routes.find(route => route.siteId === e.E2E_GATEWAY_SITE);
    assert.ok(active?.containerId);
    const protectedIds = [...state.routes, ...state.previous].map(route => route.containerId);
    const initial = list();
    const info = JSON.parse(execFileSync('docker', ['inspect', active.containerId], { encoding: 'utf8' }))[0];
    const values = Object.fromEntries(info.Config.Env.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
    assert.equal(info.Config.Labels['gateway.site-id'], e.E2E_GATEWAY_SITE);
    const at = info.Config.Image.lastIndexOf('@');
    const image = { repository: info.Config.Image.slice(0, at), digest: info.Config.Image.slice(at + 1) };
    const docker = createDockerEngineClient({ socketPath: env.DOCKER_SOCKET_PATH, platform: env.GATEWAY_DOCKER_PLATFORM, approvedImages: [info.Config.Image] });
    const adapter = createDockerCandidateAdapter(docker, { network: 'gateway-sites', images: [image] });
    let denyDeletion = true, rejected = 0;
    const proxy = http.createServer();
    proxy.on('request', (request, response) => {
        if (denyDeletion && request.method === 'DELETE') { rejected++; response.writeHead(503); response.end(); return; }
        const upstream = http.request({ socketPath: env.DOCKER_SOCKET_PATH, path: request.url, method: request.method, headers: request.headers }, result => {
            response.writeHead(result.statusCode, result.headers); result.pipe(response);
        });
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); }); request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(proxySocket, resolve));
    const orphans = [];
    await stop();
    try {
        for (let n = 0; n < 3; n++) {
            const portServer = net.createServer();
            await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
            const port = portServer.address().port;
            await new Promise(resolve => portServer.close(resolve));
            orphans.push(await adapter.startCandidate({
                siteId: e.E2E_GATEWAY_SITE, releaseId: active.releaseId, image,
                workspaceId: values.NUXT_WORKSPACE_ID, credential: values.NUXT_SITE_CREDENTIAL,
                gatewayUrl: values.NUXT_GATEWAY_URL, hostPort: port,
            }));
        }
        await start(proxySocket);
        await until(() => rejected >= 3);
        assert.ok(orphans.every(id => list().includes(id)), 'failed removals must remain discoverable');
        assert.equal(await home(), 200);
        await stop(); // Lose every in-memory cleanup result while deletion is still unavailable.
        denyDeletion = false;
        await start(proxySocket);
        await until(() => orphans.every(id => !list().includes(id)));
        const final = list();
        assert.ok(protectedIds.every(id => final.includes(id)), 'current and previous containers must survive');
        assert.ok(initial.every(id => final.includes(id)), 'unrelated base containers must survive');
        assert.equal(await home(), 200);
        await writeFile(`${runtimeDir}/gateway-retirement-result.json`, JSON.stringify({
            orphanIds: orphans, removedAutomatically: orphans.length, rejectedDeletionAttempts: rejected,
            protectedContainersRetained: protectedIds.length, preexistingContainersRetained: initial.length, publicStatus: 200,
        }, null, 2));
    } finally {
        await stop();
        proxy.closeAllConnections();
        await new Promise(resolve => proxy.close(resolve));
        await unlink(proxySocket).catch(() => undefined);
        await start(env.DOCKER_SOCKET_PATH);
    }
});
