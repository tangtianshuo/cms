import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
const dir = process.env.E2E_RUNTIME_DIR;
test(
    'real candidate failure keeps active release; worker restart recovers verified route',
    { skip: !dir, timeout: 120000 },
    async () => {
        const root = path.resolve(dir),
            e = Object.fromEntries(
                (await readFile(`${root}/runtime.env`, 'utf8'))
                    .trim()
                    .split('\n')
                    .map((s) => s.split('=')),
            );
        const gateway = path.resolve(
            process.env.E2E_GATEWAY_ROOT || '../Independent-Website-Gateway',
        );
        const login = await fetch('http://127.0.0.1:18080/api/v4/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: e.E2E_EMAIL,
                password: e.E2E_PASSWORD,
            }),
        }).then((r) => r.json());
        const headers = {
            'content-type': 'application/json',
            authorization: `Bearer ${login.accessToken}`,
            'x-bcms-workspace': e.E2E_CMS_WORKSPACE,
            'x-bcms-site': e.E2E_CMS_SITE,
        };
        async function api(url, body) {
            const r = await fetch(`http://127.0.0.1:18080/api/v4/${url}`, {
                headers,
                method: body === undefined ? 'GET' : 'POST',
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            assert.equal(r.status, 200, await r.clone().text());
            return r.json();
        }
        function home() {
            return new Promise((resolve, reject) => {
                http.get(
                    'http://127.0.0.1:18090/',
                    { headers: { host: 'shop.localhost' } },
                    (r) => {
                        r.resume();
                        r.on('end', () => resolve(r.statusCode));
                    },
                ).on('error', reject);
            });
        }
        async function until(check) {
            for (let n = 0; n < 100; n++) {
                if (await check()) return;
                await new Promise((r) => setTimeout(r, 200));
            }
            assert.fail('worker condition timed out');
        }
        let worker;
        async function stop() {
            let pid =
                worker?.pid ||
                Number(await readFile(`${root}/worker.pid`, 'utf8'));
            try {
                process.kill(pid, 'SIGTERM');
            } catch (err) {
                if (err.code !== 'ESRCH') throw err;
            }
            await until(async () => {
                try {
                    await home();
                    return false;
                } catch {
                    return true;
                }
            });
            worker = undefined;
        }
        async function start(port) {
            const log = await open(`${root}/worker-recovery.log`, 'a');
            worker = spawn(
                process.execPath,
                [`${gateway}/packages/worker/dist/index.js`],
                {
                    cwd: gateway,
                    detached: true,
                    stdio: ['ignore', log.fd, log.fd],
                    env: {
                        ...process.env,
                        DATABASE_URL: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
                        GATEWAY_CONTROL_URL: `http://host.docker.internal:${port}`,
                        DOCKER_SOCKET_PATH:
                            process.env.DOCKER_SOCKET_PATH ||
                            `${process.env.HOME}/.docker/run/docker.sock`,
                        GATEWAY_DOCKER_PLATFORM: 'linux/amd64',
                        GATEWAY_PROXY_PORT: '18090',
                        GATEWAY_ROUTE_STATE_PATH: `${root}/gateway-routes.json`,
                    },
                },
            );
            worker.unref();
            await log.close();
            await writeFile(`${root}/worker.pid`, String(worker.pid));
            await until(async () => {
                try {
                    return (await home()) === 200;
                } catch {
                    return false;
                }
            });
        }
        const before = await api('presets/releases/');
        assert.ok(before.currentReleaseId);
        assert.equal(await home(), 200);
        await stop();
        try {
            await start(18184); // Intentionally unreachable candidate snapshot endpoint, never changes image approval/security.
            const check = await api('presets/releases/check', {});
            assert.equal(check.valid, true);
            const op = await api('presets/releases/publish', {
                target: 'gateway',
                expectedReleaseId: before.currentReleaseId,
                requestKey: randomUUID(),
                snapshotHash: check.snapshotHash,
            });
            let outcome;
            for (let n = 0; n < 60; n++) {
                outcome = await api(
                    `presets/releases/gateway/operations/${op.operationId}`,
                );
                if (outcome.status === 'failed') break;
                assert.notEqual(outcome.status, 'ready');
                await new Promise((r) => setTimeout(r, 500));
            }
            assert.equal(outcome.status, 'failed', JSON.stringify(outcome));
            assert.equal(
                (await api('presets/releases/')).currentReleaseId,
                before.currentReleaseId,
            );
            assert.equal(await home(), 200);
            await writeFile(
                `${root}/gateway-recovery-result.json`,
                JSON.stringify(
                    {
                        activeReleaseId: before.currentReleaseId,
                        failure: outcome,
                        oldSiteStatus: 200,
                    },
                    null,
                    2,
                ),
            );
        } finally {
            await stop();
            await start(18183);
        }
        assert.equal(
            (await api('presets/releases/')).currentReleaseId,
            before.currentReleaseId,
        );
        assert.equal(await home(), 200);
    },
);
