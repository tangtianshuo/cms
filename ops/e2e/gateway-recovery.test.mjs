import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, open, chmod } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { gatewayRoot, runtimeDir, readEnv, workerEnv } from './runtime.mjs';
test(
    'public registry candidate artifact integrity failure preserves traffic and active authority',
    { skip: !process.env.E2E_RUNTIME_DIR, timeout: 120000 },
    async () => {
        const e = await readEnv();
        const { Pool } = createRequire(path.join(gatewayRoot, 'package.json'))(
            'pg',
        );
        const pool = new Pool({ connectionString: workerEnv(e).DATABASE_URL });
        let worker;
        let artifact;
        let original;
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
        const api = async (url, body) => {
            const r = await fetch(`http://127.0.0.1:18080/api/v4/${url}`, {
                headers,
                method: body === undefined ? 'GET' : 'POST',
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            assert.equal(r.status, 200, await r.clone().text());
            return r.json();
        };
        const home = () =>
            new Promise((resolve, reject) =>
                http
                    .get(
                        'http://127.0.0.1:18090/',
                        { headers: { host: 'shop.localhost' } },
                        (r) => {
                            r.resume();
                            r.on('end', () => resolve(r.statusCode));
                        },
                    )
                    .on('error', reject),
            );
        const until = async (check) => {
            for (let n = 0; n < 150; n++) {
                if (await check()) return;
                await new Promise((r) => setTimeout(r, 200));
            }
            assert.fail('Owned worker condition timed out');
        };
        const state = async () =>
            (
                await pool.query(
                    'SELECT "releaseId","imageDigest","routeRevision" FROM "ActiveDeployment" WHERE "siteId"=$1',
                    [e.E2E_GATEWAY_SITE],
                )
            ).rows[0];
        async function stop() {
            const pid =
                worker?.pid ||
                Number(
                    await readFile(path.join(runtimeDir, 'worker.pid'), 'utf8'),
                );
            // PID files are not sufficient ownership proof; verify the exact expected entrypoint.
            const command = execFileSync(
                'ps',
                ['-p', String(pid), '-o', 'command='],
                { encoding: 'utf8' },
            );
            assert.ok(
                command.includes(
                    path.join(gatewayRoot, 'packages/worker/dist/index.js'),
                ),
            );
            process.kill(pid, 'SIGTERM');
            await until(async () => {
                try {
                    process.kill(pid, 0);
                    return false;
                } catch (error) {
                    if (error.code === 'ESRCH') return true;
                    throw error;
                }
            });
            worker = undefined;
            assert.equal(
                await home(),
                200,
                'Independent traffic must survive worker exit',
            );
        }
        async function start() {
            const logPath = path.join(
                runtimeDir,
                `worker-recovery-${randomUUID()}.log`,
            );
            const log = await open(logPath, 'w');
            worker = spawn(
                process.execPath,
                [path.join(gatewayRoot, 'packages/worker/dist/index.js')],
                {
                    cwd: gatewayRoot,
                    env: workerEnv(e),
                    detached: true,
                    stdio: ['ignore', log.fd, log.fd],
                },
            );
            worker.unref();
            await log.close();
            await writeFile(
                path.join(runtimeDir, 'worker.pid'),
                String(worker.pid),
            );
            await until(async () => {
                assert.equal(worker.exitCode, null);
                return (await readFile(logPath, 'utf8')).includes(
                    'Gateway worker started',
                );
            });
        }
        try {
            const before = await state();
            assert.ok(before?.releaseId);
            assert.equal(await home(), 200);
            await stop();
            const check = await api('presets/releases/check', {});
            assert.equal(check.valid, true);
            const op = await api('presets/releases/publish', {
                target: 'gateway',
                expectedReleaseId: before.releaseId,
                requestKey: randomUUID(),
                snapshotHash: check.snapshotHash,
            });
            const row = (
                await pool.query(
                    'SELECT "snapshotRef" FROM "Release" WHERE "siteId"=$1 AND "releaseId"=$2',
                    [e.E2E_GATEWAY_SITE, op.releaseId],
                )
            ).rows[0];
            assert.notEqual(op.releaseId, before.releaseId);
            artifact = path.join(
                e.E2E_SNAPSHOT_HOST_DIR,
                path.basename(row.snapshotRef),
            );
            original = await readFile(artifact);
            await chmod(artifact, 0o600);
            await writeFile(artifact, 'corrupt unpublished candidate');
            await chmod(artifact, 0o444);
            await start();
            let outcome;
            await until(async () => {
                outcome = await api(
                    `presets/releases/gateway/operations/${op.operationId}`,
                );
                return outcome.status === 'failed';
            });
            assert.deepEqual(await state(), before);
            assert.equal(await home(), 200);
            await writeFile(
                path.join(runtimeDir, 'gateway-recovery-result.json'),
                JSON.stringify(
                    {
                        scenario: 'artifact-integrity-failure',
                        active: before,
                        failure: outcome,
                        independentTrafficStatus: 200,
                    },
                    null,
                    2,
                ),
            );
        } finally {
            try {
                if (artifact && original) {
                    await chmod(artifact, 0o600);
                    await writeFile(artifact, original);
                    await chmod(artifact, 0o444);
                }
                if (!worker) await start();
            } finally {
                await pool.end();
            }
        }
    },
);
