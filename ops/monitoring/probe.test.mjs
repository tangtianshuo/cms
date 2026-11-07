import assert from 'node:assert/strict';
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
import {
    probePublishedSite,
    readBackupEvidence,
    readMonitorState,
    runMonitor,
    validateConfig,
    writeMonitorState,
} from './probe.mjs';
import { createMonitorState } from './policy.mjs';

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
