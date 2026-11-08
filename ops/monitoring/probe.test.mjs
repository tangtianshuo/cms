import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtemp,
    mkdir,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    probePublishedSite,
    readBackupEvidence,
    readMonitorState,
    runMonitor,
    validateConfig,
    writeMonitorState,
} from './probe.mjs';
import {
    createMonitorState,
    markNotificationDelivered,
    markNotificationFailed,
    reconcileAlerts,
} from './policy.mjs';

const digest = (value) =>
    `sha256:${createHash('sha256').update(value).digest('hex')}`;
const expectedTemplate = {
    id: 'aeroframe',
    version: '1.0.4',
    manifestChecksum: `sha256:${'b'.repeat(64)}`,
};

function lock() {
    return {
        schemaVersion: 1,
        contractVersion: 1,
        repositories: Object.fromEntries(
            ['cms', 'gateway', 'templates', 'preview'].map((repository) => [
                repository,
                { repository: `example/${repository}`, commit: 'a'.repeat(40) },
            ]),
        ),
        templates: [
            {
                id: 'aeroframe',
                version: '1.0.4',
                manifestChecksum: `sha256:${'b'.repeat(64)}`,
                imageDigest: `sha256:${'c'.repeat(64)}`,
                previewArtifactDigest: `sha256:${'d'.repeat(64)}`,
                previewBundleDigest: `sha256:${'e'.repeat(64)}`,
            },
        ],
    };
}

async function withServer(handler, run) {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        return await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.close();
        server.closeAllConnections();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

test('public probe rejects a wrong release and missing asset without credentials', async () => {
    const seenHeaders = [];
    await withServer(
        (request, response) => {
            seenHeaders.push(request.headers);
            response.setHeader('connection', 'close');
            if (request.url === '/') {
                response.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                    'x-platform-release-id': 'release-2',
                });
                response.end('<html><h1>old site</h1></html>');
            } else if (request.url === '/asset.png') {
                response.writeHead(404, { 'content-type': 'text/html' });
                response.end('missing');
            }
        },
        async (origin) => {
            const result = await probePublishedSite({
                id: 'site-a',
                origin,
                path: '/',
                marker: 'new-site-marker',
                expectedReleaseId: 'release-2',
                assets: [
                    { path: '/asset.png', contentType: 'image/png' },
                    { path: '/unused.css', contentType: 'text/css' },
                ],
            });
            assert.equal(result.publicStatus, 200);
            assert.equal(result.markerPresent, false);
            assert.equal(result.expectedRelease, false);
            assert.equal(result.missingAssets, 2);
        },
    );
    assert.equal(seenHeaders.length, 3);
    for (const headers of seenHeaders) {
        assert.equal(headers.authorization, undefined);
        assert.equal(headers.cookie, undefined);
    }
});

test('public probe follows manual redirects for challenge detection', async () => {
    await withServer(
        (_request, response) => {
            response.setHeader('connection', 'close');
            response.writeHead(302, { location: 'https://challenge.invalid/' });
            response.end();
        },
        async (origin) => {
            const result = await probePublishedSite({
                id: 'site-b',
                origin,
                path: '/',
                marker: 'never-seen',
                assets: [],
            });
            assert.equal(result.publicStatus, 302);
            assert.equal(result.expectedRelease, false);
        },
    );
});

test('backup age comes from a verified completion manifest, not file mtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-backup-'));
    try {
        const root = join(directory, 'completed');
        await mkdir(root, { mode: 0o700 });
        const lockBytes = JSON.stringify(lock());
        const marker = Buffer.from('verified');
        await writeFile(join(root, 'platform-lock.json'), lockBytes);
        await writeFile(join(root, 'marker.txt'), marker);
        const manifest = {
            schemaVersion: 1,
            backupId: 'backup-1',
            createdAt: '2026-11-06T00:00:00+00:00',
            lockChecksum: digest(lockBytes),
            evidenceType: 'source-only-local',
            files: [
                {
                    path: 'marker.txt',
                    sha256: createHash('sha256').update(marker).digest('hex'),
                    size: marker.length,
                },
                {
                    path: 'platform-lock.json',
                    sha256: createHash('sha256')
                        .update(lockBytes)
                        .digest('hex'),
                    size: lockBytes.length,
                },
            ],
            sites: [],
        };
        await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
        const result = await readBackupEvidence(root, {
            environment: 'local',
            now: Date.parse('2026-11-07T02:00:00Z'),
        });
        assert.equal(result.accepted, true);
        assert.equal(result.scope, 'source-only-local');
        assert.equal(result.ageHours, 26);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('backup verification rejects changed bytes and production source-only evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-backup-invalid-'));
    try {
        const root = join(directory, 'completed');
        await mkdir(root, { mode: 0o700 });
        const lockBytes = JSON.stringify(lock());
        await writeFile(join(root, 'platform-lock.json'), lockBytes);
        await writeFile(join(root, 'marker.txt'), 'changed');
        const manifest = {
            schemaVersion: 1,
            backupId: 'backup-2',
            createdAt: new Date().toISOString(),
            lockChecksum: digest(lockBytes),
            evidenceType: 'source-only-local',
            files: [
                {
                    path: 'marker.txt',
                    sha256: createHash('sha256')
                        .update('original')
                        .digest('hex'),
                    size: 8,
                },
                {
                    path: 'platform-lock.json',
                    sha256: createHash('sha256')
                        .update(lockBytes)
                        .digest('hex'),
                    size: lockBytes.length,
                },
            ],
            sites: [],
        };
        await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
        assert.equal(
            (await readBackupEvidence(root, { environment: 'local' })).reason,
            'backup_verification_failed',
        );
        await writeFile(join(root, 'marker.txt'), 'original');
        assert.equal(
            (await readBackupEvidence(root, { environment: 'production' }))
                .reason,
            'formal_backup_evidence_required',
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('monitor state is private and survives a fresh read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-state-'));
    try {
        const path = join(directory, 'state.json');
        const state = createMonitorState();
        state.sites['site-a'] = {
            alerts: {},
            pending: [],
            deliveryHistory: [],
            consecutiveSlowSamples: 2,
        };
        await writeMonitorState(path, state);
        assert.deepEqual(await readMonitorState(path), state);
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        await writeFile(path, '{');
        await assert.rejects(
            () => readMonitorState(path),
            /Invalid monitor state/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('monitor retries delivery independently and emits one recovery after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-monitor-'));
    const statePath = join(directory, 'state.json');
    process.env.F3_MONITOR_TOKEN = 'test-only';
    let publicStatus = 503;
    let deliveryAttempts = 0;
    const config = {
        schemaVersion: 1,
        environment: 'local',
        statePath,
        sites: [
            {
                id: 'site-a',
                origin: 'http://127.0.0.1:18080',
                path: '/',
                marker: 'marker-a',
                expectedTemplate,
                assets: [],
            },
        ],
        control: {
            url: 'http://127.0.0.1:18081',
            tokenEnv: 'F3_MONITOR_TOKEN',
        },
        backup: { directory: join(directory, 'backup') },
        notification: {
            url: 'http://127.0.0.1:18082',
            retryMs: 1000,
        },
    };
    const options = (now) => ({
        now,
        publicProbe: async () => ({
            publicStatus,
            latencyMs: 50,
            markerPresent: publicStatus === 200,
            expectedRelease: publicStatus === 200,
            missingAssets: 0,
            assets: [],
        }),
        controlProbe: async () => ({
            available: true,
            releaseMatches: true,
            publishFailureCount15m: 0,
        }),
        backupProbe: async () => ({
            accepted: true,
            valid: true,
            ageHours: 1,
            scope: 'source-only-local',
            reason: null,
            lockTemplates: [expectedTemplate],
        }),
        certificateProbe: async () => 30,
        deliver: async () => {
            deliveryAttempts += 1;
            if (deliveryAttempts === 1) throw new Error('receiver unavailable');
            return true;
        },
    });
    try {
        const started = Date.parse('2026-11-07T00:00:00Z');
        await runMonitor(config, options(started));
        await runMonitor(config, options(started + 60_000));
        const third = await runMonitor(config, options(started + 120_000));
        assert.equal(third.alertCount, 1);
        assert.equal(third.deliveries[0].status, 'retry-scheduled');
        assert.equal(third.pendingNotifications, 1);

        const fourth = await runMonitor(config, options(started + 123_000));
        assert.equal(fourth.deliveries[0].status, 'delivered');
        assert.equal(fourth.pendingNotifications, 0);

        publicStatus = 200;
        const fifth = await runMonitor(config, options(started + 124_000));
        assert.equal(fifth.sites[0].recoveryNotifications.length, 1);
        assert.equal(fifth.deliveries[0].status, 'delivered');
        const sixth = await runMonitor(config, options(started + 125_000));
        assert.equal(sixth.sites[0].recoveryNotifications.length, 0);
        assert.equal(sixth.deliveries.length, 0);
        assert.equal(sixth.healthy, true);
    } finally {
        delete process.env.F3_MONITOR_TOKEN;
        await rm(directory, { recursive: true, force: true });
    }
});

test('monitor recovers a stale one-shot lock after abrupt termination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-lock-'));
    const statePath = join(directory, 'state.json');
    const lockPath = `${statePath}.lock`;
    const config = {
        schemaVersion: 1,
        environment: 'local',
        statePath,
        sites: [
            {
                id: 'site-a',
                origin: 'http://127.0.0.1:18080',
                path: '/',
                marker: 'marker-a',
                expectedTemplate,
                assets: [],
            },
        ],
        control: {
            url: 'http://127.0.0.1:18081',
            tokenEnv: 'F3_LOCK_TOKEN',
        },
        backup: { directory: join(directory, 'backup') },
        notification: null,
    };
    process.env.F3_LOCK_TOKEN = 'test-only';
    await writeFile(
        lockPath,
        JSON.stringify({
            pid: 999999,
            createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        }),
        { mode: 0o600 },
    );
    try {
        const result = await runMonitor(config, {
            publicProbe: async () => ({
                publicStatus: 200,
                latencyMs: 20,
                markerPresent: true,
                expectedRelease: true,
                missingAssets: 0,
                assets: [],
            }),
            controlProbe: async () => ({
                available: true,
                releaseMatches: true,
                publishFailureCount15m: 0,
            }),
            backupProbe: async () => ({
                accepted: true,
                valid: true,
                ageHours: 1,
                reason: null,
                lockTemplates: [expectedTemplate],
            }),
            certificateProbe: async () => 30,
        });
        assert.equal(result.notification, 'monitoring-unconfigured');
        await assert.rejects(() => stat(lockPath), { code: 'ENOENT' });
    } finally {
        delete process.env.F3_LOCK_TOKEN;
        await rm(directory, { recursive: true, force: true });
    }
});

test('local notification configuration stays on the loopback receiver', () => {
    const base = {
        schemaVersion: 1,
        environment: 'local',
        statePath: '/tmp/state.json',
        sites: [
            {
                id: 'site-a',
                origin: 'http://127.0.0.1:18080',
                path: '/',
                marker: 'marker-a',
                expectedTemplate,
                assets: [],
            },
        ],
        control: {
            url: 'http://127.0.0.1:18081',
            tokenEnv: 'F3_TOKEN',
        },
        backup: { directory: '/tmp/backup' },
    };
    assert.throws(
        () =>
            validateConfig({
                ...base,
                notification: { url: 'https://alerts.example.invalid/hook' },
            }),
        /loopback/,
    );
    assert.throws(
        () =>
            validateConfig({
                ...base,
                notification: { url: 'http://user:secret@127.0.0.1/hook' },
            }),
        /credential-free/,
    );
});

test(
    'public probe bounds a response whose body never completes',
    { timeout: 1_500 },
    async () => {
        const fetcher = async (_url, { signal }) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        signal.addEventListener(
                            'abort',
                            () =>
                                controller.error(
                                    new Error('body deadline exceeded'),
                                ),
                            { once: true },
                        );
                    },
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                },
            );
        const result = await probePublishedSite(
            {
                id: 'site-a',
                origin: 'http://127.0.0.1:18080',
                path: '/',
                marker: 'marker-a',
                assets: [],
            },
            { fetcher, timeoutMs: 50 },
        );
        assert.equal(result.publicStatus, 0);
        assert.equal(result.expectedRelease, false);
        assert.match(result.pageError, /deadline|abort/i);
    },
);

test(
    'control body stalls become a separate unavailable observation',
    { timeout: 1_500 },
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'f3-control-timeout-'));
        const statePath = join(directory, 'state.json');
        process.env.F3_BODY_TOKEN = 'test-only';
        const fetcher = async (_url, { signal }) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        signal.addEventListener(
                            'abort',
                            () =>
                                controller.error(
                                    new Error('control body deadline exceeded'),
                                ),
                            { once: true },
                        );
                    },
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            );
        try {
            const result = await runMonitor(
                {
                    schemaVersion: 1,
                    environment: 'local',
                    statePath,
                    sites: [
                        {
                            id: 'site-a',
                            origin: 'http://127.0.0.1:18080',
                            path: '/',
                            marker: 'marker-a',
                            expectedTemplate,
                            assets: [],
                        },
                    ],
                    control: {
                        url: 'http://127.0.0.1:18081',
                        tokenEnv: 'F3_BODY_TOKEN',
                        timeoutMs: 50,
                    },
                    backup: { directory: join(directory, 'backup') },
                    notification: null,
                },
                {
                    fetcher,
                    now: Date.parse('2026-11-07T00:00:00Z'),
                    publicProbe: async () => ({
                        publicStatus: 200,
                        latencyMs: 20,
                        markerPresent: true,
                        expectedRelease: true,
                        missingAssets: 0,
                        assets: [],
                    }),
                    backupProbe: async () => ({
                        accepted: true,
                        valid: true,
                        ageHours: 1,
                        reason: null,
                        lockTemplates: [expectedTemplate],
                    }),
                    certificateProbe: async () => 30,
                },
            );
            assert.equal(result.sites[0].control.available, false);
            assert.match(result.sites[0].control.reason, /deadline|abort/i);
            assert.equal(result.sites[0].public.publicStatus, 200);
        } finally {
            delete process.env.F3_BODY_TOKEN;
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test('monitor passes the configured backup age threshold into policy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-backup-threshold-'));
    try {
        const result = await runMonitor(
            {
                schemaVersion: 1,
                environment: 'local',
                statePath: join(directory, 'state.json'),
                sites: [
                    {
                        id: 'site-a',
                        origin: 'http://127.0.0.1:18080',
                        path: '/',
                        marker: 'marker-a',
                        expectedTemplate,
                        assets: [],
                    },
                ],
                control: {
                    url: 'http://127.0.0.1:18081',
                    tokenEnv: 'F3_THRESHOLD_TOKEN',
                },
                backup: {
                    directory: join(directory, 'backup'),
                    maxAgeHours: 2,
                },
                notification: null,
            },
            {
                now: Date.parse('2026-11-07T00:00:00Z'),
                publicProbe: async () => ({
                    publicStatus: 200,
                    latencyMs: 20,
                    markerPresent: true,
                    expectedRelease: true,
                    missingAssets: 0,
                    assets: [],
                }),
                controlProbe: async () => ({
                    available: true,
                    releaseMatches: true,
                    publishFailureCount15m: 0,
                }),
                backupProbe: async () => ({
                    accepted: true,
                    valid: true,
                    ageHours: 3,
                    reason: null,
                    lockTemplates: [expectedTemplate],
                }),
                certificateProbe: async () => 30,
            },
        );
        assert.deepEqual(
            result.sites[0].alerts.map((alert) => alert.key),
            ['site-a:backup-stale'],
        );
        assert.equal(result.sites[0].health.backupMaxAgeHours, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('monitor reports bounded publication queue capacity metrics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-queue-metrics-'));
    const publishQueue = {
        sitePending: 20,
        workspacePending: 100,
        globalPending: 12,
        siteActiveLeases: 1,
        workspaceActiveLeases: 2,
        globalActiveLeases: 4,
        limits: {
            sitePending: 20,
            workspacePending: 100,
            siteActiveLeases: 1,
            workspaceActiveLeases: 2,
            globalActiveLeases: 4,
            siteStartIntervalMs: 5_000,
            retryAfterSeconds: 5,
        },
    };
    try {
        const result = await runMonitor(
            {
                schemaVersion: 1,
                environment: 'local',
                statePath: join(directory, 'state.json'),
                sites: [
                    {
                        id: 'site-a',
                        origin: 'http://127.0.0.1:18080',
                        path: '/',
                        marker: 'marker-a',
                        expectedTemplate,
                        assets: [],
                    },
                ],
                control: {
                    url: 'http://127.0.0.1:18081',
                    tokenEnv: 'F3_QUEUE_TOKEN',
                },
                backup: { directory: join(directory, 'backup') },
                notification: null,
            },
            {
                now: Date.parse('2026-11-07T00:00:00Z'),
                publicProbe: async () => ({
                    publicStatus: 200,
                    latencyMs: 20,
                    markerPresent: true,
                    expectedRelease: true,
                    missingAssets: 0,
                    assets: [],
                }),
                controlProbe: async () => ({
                    available: true,
                    releaseMatches: true,
                    publishFailureCount15m: 0,
                    publishQueue,
                }),
                backupProbe: async () => ({
                    accepted: true,
                    valid: true,
                    ageHours: 1,
                    reason: null,
                    lockTemplates: [expectedTemplate],
                }),
                certificateProbe: async () => 30,
            },
        );
        assert.deepEqual(result.sites[0].health.publishQueue, publishQueue);
        assert.deepEqual(
            result.sites[0].alerts.map((alert) => alert.key),
            [
                'site-a:publish-site-backlog',
                'site-a:publish-workspace-backlog',
                'site-a:publish-global-capacity',
            ],
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test(
    'stale-lock contention admits exactly one real process',
    { timeout: 15_000 },
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'f3-lock-processes-'));
        const probeUrl = pathToFileURL(
            fileURLToPath(new URL('./probe.mjs', import.meta.url)),
        ).href;
        const source = `
        import { readFile } from 'node:fs/promises';
        import { runMonitor } from ${JSON.stringify(probeUrl)};
        const config = JSON.parse(await readFile(process.argv[1], 'utf8'));
        try {
            const result = await runMonitor(config, {
                now: Date.parse('2026-11-07T00:00:00Z'),
                publicProbe: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    return { publicStatus: 200, latencyMs: 20, markerPresent: true,
                        expectedRelease: true, missingAssets: 0, assets: [] };
                },
                controlProbe: async () => ({ available: true, releaseMatches: true,
                    publishFailureCount15m: 0 }),
                backupProbe: async () => ({ accepted: true, valid: true, ageHours: 1,
                    reason: null, lockTemplates: [${JSON.stringify(expectedTemplate)}] }),
                certificateProbe: async () => 30,
            });
            console.log(JSON.stringify({ status: 'ran', healthy: result.healthy }));
        } catch (error) {
            console.log(JSON.stringify({ status: 'error', message: String(error.message) }));
            process.exitCode = 1;
        }
    `;
        const run = (configPath) =>
            new Promise((resolve, reject) => {
                const child = spawn(
                    process.execPath,
                    ['--input-type=module', '-e', source, configPath],
                    { stdio: ['ignore', 'pipe', 'pipe'] },
                );
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (chunk) => {
                    stdout += chunk;
                });
                child.stderr.on('data', (chunk) => {
                    stderr += chunk;
                });
                child.once('error', reject);
                child.once('exit', (code) => resolve({ code, stdout, stderr }));
            });
        try {
            for (let round = 0; round < 3; round += 1) {
                const statePath = join(directory, `state-${round}.json`);
                const configPath = join(directory, `config-${round}.json`);
                await writeFile(
                    configPath,
                    JSON.stringify({
                        schemaVersion: 1,
                        environment: 'local',
                        statePath,
                        sites: [
                            {
                                id: 'site-a',
                                origin: 'http://127.0.0.1:18080',
                                path: '/',
                                marker: 'marker-a',
                                expectedTemplate,
                                assets: [],
                            },
                        ],
                        control: {
                            url: 'http://127.0.0.1:18081',
                            tokenEnv: 'F3_LOCK_PROCESS_TOKEN',
                        },
                        backup: {
                            directory: join(directory, `backup-${round}`),
                        },
                        notification: null,
                    }),
                );
                await writeFile(
                    `${statePath}.lock`,
                    JSON.stringify({
                        pid: 999999,
                        createdAt: new Date(
                            Date.now() - 3_600_000,
                        ).toISOString(),
                    }),
                    { mode: 0o600 },
                );
                const [first, second] = await Promise.all([
                    run(configPath),
                    run(configPath),
                ]);
                const outcomes = [first, second].map((child) =>
                    JSON.parse(child.stdout.trim().split('\n').at(-1)),
                );
                assert.equal(
                    outcomes.filter((outcome) => outcome.status === 'ran')
                        .length,
                    1,
                );
                assert.equal(
                    outcomes.filter(
                        (outcome) =>
                            outcome.status === 'error' &&
                            outcome.message === 'monitor_locked',
                    ).length,
                    1,
                );
                assert.equal(
                    [first, second].filter((child) => child.code === 1).length,
                    1,
                );
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test('exhausted recovery delivery keeps monitor unhealthy until explicit acknowledgment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'f3-delivery-exhausted-'));
    const statePath = join(directory, 'state.json');
    const started = Date.parse('2026-11-07T00:00:00Z');
    let state = createMonitorState();
    let transition = reconcileAlerts(
        state,
        'site-a',
        [
            {
                key: 'site-a:public-unavailable',
                severity: 'critical',
                message: 'down',
            },
        ],
        started,
    );
    state = markNotificationDelivered(
        transition.state,
        transition.notifications[0].id,
        started + 1_000,
    );
    transition = reconcileAlerts(state, 'site-a', [], started + 2_000);
    state = transition.state;
    const recovery = transition.notifications[0];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
        state = markNotificationFailed(
            state,
            recovery.id,
            'receiver unavailable',
            started + 2_000 + attempt * 1_000,
            1_000,
        ).state;
    }
    await writeMonitorState(statePath, state);
    const config = {
        schemaVersion: 1,
        environment: 'local',
        statePath,
        sites: [
            {
                id: 'site-a',
                origin: 'http://127.0.0.1:18080',
                path: '/',
                marker: 'marker-a',
                expectedTemplate,
                assets: [],
            },
        ],
        control: {
            url: 'http://127.0.0.1:18081',
            tokenEnv: 'F3_EXHAUSTED_TOKEN',
        },
        backup: { directory: join(directory, 'backup') },
        notification: { url: 'http://127.0.0.1:18082/alerts' },
    };
    const run = (now) =>
        runMonitor(config, {
            now,
            publicProbe: async () => ({
                publicStatus: 200,
                latencyMs: 20,
                markerPresent: true,
                expectedRelease: true,
                missingAssets: 0,
                assets: [],
            }),
            controlProbe: async () => ({
                available: true,
                releaseMatches: true,
                publishFailureCount15m: 0,
            }),
            backupProbe: async () => ({
                accepted: true,
                valid: true,
                ageHours: 1,
                reason: null,
                lockTemplates: [expectedTemplate],
            }),
            certificateProbe: async () => 30,
            deliver: async () => true,
        });
    try {
        const unresolved = await run(started + 20_000);
        assert.equal(unresolved.healthy, false);
        assert.equal(unresolved.deliveryFailures.length, 1);
        assert.equal(unresolved.deliveryFailures[0].id, recovery.id);

        const { acknowledgeDeliveryFailure } = await import('./probe.mjs');
        await acknowledgeDeliveryFailure(
            statePath,
            recovery.id,
            started + 21_000,
        );
        const cleared = await run(started + 22_000);
        assert.equal(cleared.healthy, true);
        assert.deepEqual(cleared.deliveryFailures, []);
    } finally {
        delete process.env.F3_EXHAUSTED_TOKEN;
        await rm(directory, { recursive: true, force: true });
    }
});
