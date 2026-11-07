import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
// Only receives resources created by the caller's fresh, disposable fixture.
export async function launchFaults({
    sql,
    docker,
    processes,
    cmsChild,
    worker,
    app,
    gatewayPort,
    cmsAddress,
    gatewayRoot,
    runRoot,
    freePort,
    publicGet,
    sites,
    seed,
    seeds,
    formal = false,
    until,
    containerIds,
}) {
    const proof = {
        scope: formal
            ? 'formal-owned-runtime-faults'
            : 'actual-local-source-runtime-faults-not-public-acceptance',
        checks: [],
        restored: [],
    };
    const identity = async (siteId) =>
        (
            await sql.query(
                'SELECT "releaseId","routeRevision" FROM "ActiveDeployment" WHERE "siteId"=$1',
                [siteId],
            )
        ).rows[0];
    const baseline = await Promise.all(
        sites.map(async (site) => ({
            site,
            active: await identity(site.siteId),
            response: await publicGet(site.host),
        })),
    );
    const verify = async () => {
        for (const b of baseline) {
            assert.deepEqual(await identity(b.site.siteId), b.active);
            const r = await publicGet(b.site.host);
            assert.equal(r.status, 200);
            assert.equal(r.body, b.response.body);
        }
    };
    const unavailable = async (url) => {
        try {
            await fetch(url, { signal: AbortSignal.timeout(700) });
            return false;
        } catch {
            return true;
        }
    };
    try {
        // Stop the candidate process while its real image is starting; no artifact corruption.
        const candidates = seeds || [seed];
        for (const seed of candidates) {
            const releaseId = randomUUID();
            const bytes = Buffer.from(JSON.stringify(seed.snapshot));
            await seed.gateway('releases', {
                siteId: seed.binding.siteId,
                releaseId,
                checksum:
                    'sha256:' +
                    createHash('sha256').update(bytes).digest('hex'),
                metadata: seed.metadata,
                snapshot: bytes.toString('base64'),
            });
            const operation = await seed.gateway('publish-operations', {
                releaseId,
                expectedRevision: baseline.find(
                    (b) => b.site.siteId === seed.binding.siteId,
                ).active.routeRevision,
                idempotencyKey: randomUUID(),
            });
            let candidate;
            try {
                await until(
                    async () => {
                        const ids = docker([
                            'ps',
                            '-q',
                            '--filter',
                            `label=gateway.release-id=${releaseId}`,
                        ])
                            .split('\n')
                            .filter(Boolean);
                        if (ids[0]) {
                            candidate = ids[0];
                            return true;
                        }
                        return false;
                    },
                    'actual candidate start',
                    30000,
                );
                containerIds.add(candidate);
                docker(['pause', candidate]);
                const inspect = JSON.parse(docker(['inspect', candidate]))[0];
                assert.equal(inspect.State.Paused, true);
                assert.equal(
                    inspect.Config.Labels['gateway.release-id'],
                    releaseId,
                );
                let failure;
                await until(
                    async () => {
                        failure = (
                            await sql.query(
                                'SELECT "status","failureCode" FROM "PublishOperation" WHERE "id"=$1',
                                [operation.id],
                            )
                        ).rows[0];
                        return failure.status === 'failed';
                    },
                    'unhealthy runtime failure',
                    90000,
                );
                assert.equal(failure.failureCode, 'CANDIDATE_UNHEALTHY');
                await verify();
                proof.checks.push({
                    fault: 'unhealthy-candidate',
                    operationId: operation.id,
                    releaseId,
                    containerId: candidate,
                    failureCode: failure.failureCode,
                    activePreserved: true,
                });
            } finally {
                if (candidate)
                    try {
                        docker(['unpause', candidate]);
                    } catch {
                        /* worker already removed its failed candidate */
                    }
            }
        }
        processes.signalGroup(cmsChild.pid, 'SIGSTOP');
        try {
            assert.equal(
                await unavailable(cmsAddress + '/api/v4/health-check'),
                true,
            );
            await verify();
            proof.checks.push({
                fault: 'cms-stopped',
                pid: cmsChild.pid,
                activePreserved: true,
            });
        } finally {
            processes.signalGroup(cmsChild.pid, 'SIGCONT');
            proof.restored.push('cms');
        }
        await until(async () => {
            try {
                return (
                    await fetch(cmsAddress + '/api/v4/health-check', {
                        method: 'HEAD',
                    })
                ).ok;
            } catch {
                return false;
            }
        }, 'CMS restored');
        await new Promise((resolve, reject) =>
            app.server.close((error) => (error ? reject(error) : resolve())),
        );
        try {
            assert.equal(
                await unavailable(
                    `http://127.0.0.1:${gatewayPort}/api/v1/site-provisioning`,
                ),
                true,
            );
            await verify();
            proof.checks.push({
                fault: 'control-listener-stopped',
                activePreserved: true,
            });
        } finally {
            await new Promise((resolve, reject) => {
                app.server.once('error', reject);
                app.server.listen(gatewayPort, '127.0.0.1', resolve);
            });
            proof.restored.push('control');
        }
        processes.signalGroup(worker.pid, 'SIGSTOP');
        try {
            await verify();
            proof.checks.push({
                fault: 'worker-stopped',
                pid: worker.pid,
                activePreserved: true,
            });
        } finally {
            processes.signalGroup(worker.pid, 'SIGCONT');
            proof.restored.push('worker');
        }
        const port = await freePort();
        proof.ingestPort = port;
        const log = fs.openSync(
            path.join(runRoot, 'ingest.private.log'),
            'w',
            0o600,
        );
        const ingest = processes.spawn(
            process.execPath,
            [path.join(gatewayRoot, 'apps/ingest/dist/server.js')],
            {
                cwd: gatewayRoot,
                env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
                stdio: ['ignore', log, log],
            },
        );
        fs.closeSync(log);
        await until(async () => {
            try {
                await fetch(`http://127.0.0.1:${port}/`);
                return true;
            } catch {
                return false;
            }
        }, 'actual ingest');
        processes.signalGroup(ingest.pid, 'SIGSTOP');
        try {
            assert.equal(await unavailable(`http://127.0.0.1:${port}/`), true);
            await verify();
            proof.checks.push({
                fault: 'ingest-stopped',
                pid: ingest.pid,
                activePreserved: true,
            });
        } finally {
            processes.signalGroup(ingest.pid, 'SIGCONT');
            proof.restored.push('ingest');
        }
        proof.passed = true;
    } finally {
        fs.writeFileSync(
            path.join(runRoot, 'faults.json'),
            JSON.stringify(proof, null, 2) + '\n',
            { mode: 0o600 },
        );
    }
    return proof;
}
