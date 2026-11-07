#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
    chmod,
    mkdir,
    open,
    readFile,
    rename,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { connect as tlsConnect } from 'node:tls';
import {
    assessHealth,
    createMonitorState,
    dueNotifications,
    markNotificationDelivered,
    markNotificationFailed,
    reconcileAlerts,
} from './policy.mjs';
import { validatePlatformLock } from '../release/platform-lock.mjs';

const cmsRoot = fileURLToPath(new URL('../..', import.meta.url));
const requestTimeoutMs = 10_000;
const maximumPageBytes = 2 * 1024 * 1024;

function validateOrigin(value, environment) {
    const origin = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
        origin.hostname,
    );
    if (
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        !(
            origin.protocol === 'https:' ||
            (environment === 'local' && loopback && origin.protocol === 'http:')
        )
    ) {
        throw new TypeError('origin must be a credential-free HTTPS origin');
    }
    return origin.origin;
}

function validatePath(path) {
    if (
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\u0000-\u001f\u007f]/u.test(path)
    ) {
        throw new TypeError('invalid probe path');
    }
    return path;
}

function validateSite(site, environment) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
        throw new TypeError('site must be an object');
    }
    if (
        typeof site.id !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(site.id)
    ) {
        throw new TypeError('site.id is invalid');
    }
    if (typeof site.marker !== 'string' || !site.marker.trim()) {
        throw new TypeError('site.marker is required');
    }
    if (!Array.isArray(site.assets))
        throw new TypeError('site.assets is required');
    if (
        !site.expectedTemplate ||
        typeof site.expectedTemplate.id !== 'string' ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(site.expectedTemplate.id) ||
        typeof site.expectedTemplate.version !== 'string' ||
        !site.expectedTemplate.version.trim() ||
        typeof site.expectedTemplate.manifestChecksum !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(site.expectedTemplate.manifestChecksum)
    ) {
        throw new TypeError('site.expectedTemplate is invalid');
    }
    const assets = site.assets.map((asset) => {
        if (
            !asset ||
            typeof asset.contentType !== 'string' ||
            !asset.contentType.trim()
        ) {
            throw new TypeError('asset contentType is required');
        }
        return {
            path: validatePath(asset.path),
            contentType: asset.contentType.toLowerCase(),
        };
    });
    return {
        ...site,
        origin: validateOrigin(site.origin, environment),
        path: validatePath(site.path ?? '/'),
        assets,
        expectedReleaseId:
            site.expectedReleaseId === undefined
                ? undefined
                : String(site.expectedReleaseId),
    };
}

async function readBoundedText(response) {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let length = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximumPageBytes) {
            await reader.cancel();
            throw new Error('public page exceeded size limit');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
}

function contentTypeMatches(actual, expected) {
    return (
        typeof actual === 'string' &&
        actual.toLowerCase().split(';', 1)[0].trim() === expected
    );
}

async function fetchWithTimeout(
    fetcher,
    url,
    options,
    timeoutMs = requestTimeoutMs,
) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetcher(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Probe one configured public site without management credentials. Redirects
 * remain visible so challenge pages cannot be mistaken for a published site.
 */
export async function probePublishedSite(site, { fetcher = fetch } = {}) {
    const started = performance.now();
    let publicStatus = 0;
    let markerPresent = false;
    let releaseHeader = null;
    let pageError = null;
    try {
        const response = await fetchWithTimeout(
            fetcher,
            new URL(site.path ?? '/', site.origin),
            {
                method: 'GET',
                redirect: 'manual',
                headers: { accept: 'text/html,application/xhtml+xml' },
            },
        );
        publicStatus = response.status;
        releaseHeader = response.headers.get('x-platform-release-id');
        if (response.status === 200) {
            const body = await readBoundedText(response);
            markerPresent = body.includes(site.marker);
        } else {
            await response.body?.cancel();
        }
    } catch (error) {
        pageError = String(error?.message ?? error);
    }
    const latencyMs = Math.round(performance.now() - started);

    const assets = [];
    for (const asset of site.assets ?? []) {
        try {
            const response = await fetchWithTimeout(
                fetcher,
                new URL(asset.path, site.origin),
                {
                    method: 'GET',
                    redirect: 'manual',
                    headers: { accept: asset.contentType },
                },
            );
            const contentType = response.headers.get('content-type');
            await response.body?.cancel();
            assets.push({
                path: asset.path,
                status: response.status,
                contentType,
                ok:
                    response.status === 200 &&
                    contentTypeMatches(contentType, asset.contentType),
            });
        } catch (error) {
            assets.push({
                path: asset.path,
                status: 0,
                contentType: null,
                ok: false,
                error: String(error?.message ?? error),
            });
        }
    }
    const releaseHeaderMatches =
        !releaseHeader ||
        !site.expectedReleaseId ||
        releaseHeader === site.expectedReleaseId;
    return {
        publicStatus,
        latencyMs,
        markerPresent,
        releaseHeader,
        expectedRelease:
            publicStatus === 200 && markerPresent && releaseHeaderMatches,
        missingAssets: assets.filter((asset) => !asset.ok).length,
        assets,
        ...(pageError ? { pageError } : {}),
    };
}

export function certificateDaysLeft(origin, timeoutMs = requestTimeoutMs) {
    const url = new URL(origin);
    if (url.protocol === 'http:') return Promise.resolve(3650);
    return new Promise((resolve) => {
        const socket = tlsConnect(
            {
                host: url.hostname,
                port: Number(url.port || 443),
                servername: url.hostname,
                rejectUnauthorized: true,
                timeout: timeoutMs,
            },
            () => {
                const certificate = socket.getPeerCertificate();
                socket.end();
                const expires = certificate?.valid_to
                    ? Date.parse(certificate.valid_to)
                    : Number.NaN;
                resolve(
                    Number.isFinite(expires)
                        ? Math.floor((expires - Date.now()) / 86_400_000)
                        : -1,
                );
            },
        );
        socket.once('timeout', () => socket.destroy());
        socket.once('error', () => resolve(-1));
    });
}

function verifyBackupWithPython(root) {
    const script = [
        'import json,sys',
        'from pathlib import Path',
        'from ops.backup.manifest import verify_backup',
        'root=Path(sys.argv[1])',
        "verify_backup(root,json.loads((root/'manifest.json').read_text()))",
    ].join(';');
    return spawnSync('python3', ['-c', script, root], {
        cwd: cmsRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

export async function readBackupEvidence(
    root,
    {
        environment = 'local',
        lockPath,
        now = Date.now(),
        verify = verifyBackupWithPython,
    } = {},
) {
    const base = {
        root,
        accepted: false,
        valid: false,
        reason: null,
        scope: null,
        ageHours: 27.1,
        backupId: null,
        createdAt: null,
        lockTemplates: [],
    };
    try {
        const manifest = JSON.parse(
            await readFile(join(root, 'manifest.json'), 'utf8'),
        );
        base.backupId = manifest.backupId ?? null;
        base.scope = manifest.evidenceType ?? null;
        base.createdAt = manifest.createdAt ?? null;
        const result = verify(root);
        if (result.status !== 0) {
            return { ...base, reason: 'backup_verification_failed' };
        }
        const lockBytes = await readFile(join(root, 'platform-lock.json'));
        const lock = validatePlatformLock(
            JSON.parse(lockBytes.toString('utf8')),
        );
        base.lockTemplates = lock.templates.map((item) => ({
            id: item.id,
            version: item.version,
            manifestChecksum: item.manifestChecksum,
        }));
        const expectedLock = `sha256:${createHash('sha256').update(lockBytes).digest('hex')}`;
        if (manifest.lockChecksum !== expectedLock) {
            return { ...base, reason: 'lock_checksum_mismatch' };
        }
        if (
            environment === 'production' &&
            manifest.evidenceType !== 'platform-lock-bound'
        ) {
            return {
                ...base,
                valid: true,
                reason: 'formal_backup_evidence_required',
            };
        }
        if (
            !['source-only-local', 'platform-lock-bound'].includes(
                manifest.evidenceType,
            )
        ) {
            return { ...base, reason: 'backup_evidence_type_unknown' };
        }
        const createdAt = Date.parse(manifest.createdAt);
        if (!Number.isFinite(createdAt) || createdAt > now + 5 * 60_000) {
            return { ...base, reason: 'backup_timestamp_invalid' };
        }
        if (lockPath) {
            const configured = validatePlatformLock(
                JSON.parse(await readFile(lockPath, 'utf8')),
            );
            if (JSON.stringify(configured) !== JSON.stringify(lock)) {
                return { ...base, reason: 'backup_lock_identity_mismatch' };
            }
        }
        return {
            ...base,
            accepted: true,
            valid: true,
            ageHours: Math.max(0, (now - createdAt) / 3_600_000),
        };
    } catch (error) {
        return {
            ...base,
            reason:
                error?.code === 'ENOENT'
                    ? 'backup_evidence_missing'
                    : 'backup_verification_failed',
        };
    }
}

export async function readMonitorState(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        if (
            value?.schemaVersion !== 1 ||
            !value.sites ||
            typeof value.sites !== 'object' ||
            !Number.isSafeInteger(value.nextNotificationId)
        ) {
            throw new Error('Invalid monitor state');
        }
        return value;
    } catch (error) {
        if (error?.code === 'ENOENT') return createMonitorState();
        throw new Error(
            `Invalid monitor state: ${String(error?.message ?? error)}`,
            { cause: error },
        );
    }
}

export async function writeMonitorState(path, state) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(temporary, path);
        await chmod(path, 0o600);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

export function validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('config must be an object');
    }
    if (config.schemaVersion !== 1)
        throw new TypeError('schemaVersion must be 1');
    if (!['local', 'production'].includes(config.environment)) {
        throw new TypeError('environment must be local or production');
    }
    if (typeof config.statePath !== 'string' || !config.statePath) {
        throw new TypeError('statePath is required');
    }
    if (!Array.isArray(config.sites) || !config.sites.length) {
        throw new TypeError('at least one site is required');
    }
    if (
        !config.backup ||
        typeof config.backup.directory !== 'string' ||
        !config.backup.directory
    ) {
        throw new TypeError('backup.directory is required');
    }
    const sites = config.sites.map((site) =>
        validateSite(site, config.environment),
    );
    if (new Set(sites.map((site) => site.id)).size !== sites.length) {
        throw new TypeError('duplicate site id');
    }
    if (
        !config.control ||
        typeof config.control !== 'object' ||
        typeof config.control.tokenEnv !== 'string'
    ) {
        throw new TypeError('control.tokenEnv is required');
    }
    validateOrigin(config.control.url, config.environment);
    if (config.notification) {
        if (typeof config.notification.url !== 'string') {
            throw new TypeError('notification.url is required');
        }
        const notificationUrl = new URL(config.notification.url);
        if (notificationUrl.username || notificationUrl.password) {
            throw new TypeError('notification.url must be credential-free');
        }
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
            notificationUrl.hostname,
        );
        if (
            (config.environment === 'local' &&
                (notificationUrl.protocol !== 'http:' || !loopback)) ||
            (config.environment === 'production' &&
                notificationUrl.protocol !== 'https:')
        ) {
            throw new TypeError(
                'local notification receiver must use a loopback HTTP URL',
            );
        }
    }
    return {
        ...config,
        sites,
        backup: {
            maxAgeHours: 26,
            scopeId: 'platform-backup',
            ...config.backup,
        },
        control: { timeoutMs: requestTimeoutMs, ...config.control },
        notification: config.notification
            ? {
                  timeoutMs: requestTimeoutMs,
                  retryMs: 60_000,
                  ...config.notification,
              }
            : null,
    };
}

async function probeControl(config, site, fetcher = fetch) {
    const token = process.env[config.tokenEnv];
    if (!token) {
        return { available: false, reason: 'management_credential_missing' };
    }
    try {
        const url = new URL(
            `/api/v1/sites/${encodeURIComponent(site.id)}/publication-state`,
            config.url,
        );
        const response = await fetchWithTimeout(
            fetcher,
            url,
            { headers: { authorization: `Bearer ${token}` } },
            config.timeoutMs ?? requestTimeoutMs,
        );
        if (response.status !== 200) {
            return {
                available: false,
                reason: `control_status_${response.status}`,
            };
        }
        const body = await response.json();
        const active = body?.active;
        const metadata = active?.metadata;
        const expected = site.expectedTemplate;
        const releaseMatches =
            !!active &&
            (!site.expectedReleaseId ||
                active.releaseId === site.expectedReleaseId) &&
            (!expected ||
                (metadata?.templateId === expected.id &&
                    metadata?.templateVersion === expected.version &&
                    metadata?.manifestChecksum === expected.manifestChecksum));
        return {
            available: true,
            releaseMatches,
            publishFailureCount15m:
                body?.observability?.publishFailureCount15m ?? 0,
            releaseId: active?.releaseId ?? null,
            status: body?.status ?? null,
        };
    } catch (error) {
        return {
            available: false,
            reason: String(error?.message ?? error).slice(0, 200),
        };
    }
}

async function deliverNotification(notification, config, fetcher = fetch) {
    if (!config.notification) return false;
    const token = config.notification.tokenEnv
        ? process.env[config.notification.tokenEnv]
        : null;
    if (config.notification.tokenEnv && !token) {
        throw new Error('notification credential missing');
    }
    const response = await fetchWithTimeout(
        fetcher,
        config.notification.url,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'idempotency-key': notification.id,
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(notification),
        },
        config.notification.timeoutMs,
    );
    await response.body?.cancel();
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`notification_status_${response.status}`);
    }
    return true;
}

async function withStateLock(statePath, action) {
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    const lockPath = `${statePath}.lock`;
    let lock;
    try {
        lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let stale = false;
        try {
            const record = JSON.parse(await readFile(lockPath, 'utf8'));
            const createdAt = Date.parse(record.createdAt);
            const old =
                !Number.isFinite(createdAt) || Date.now() - createdAt > 180_000;
            let alive = false;
            if (Number.isSafeInteger(record.pid) && record.pid > 0) {
                try {
                    process.kill(record.pid, 0);
                    alive = true;
                } catch (probeError) {
                    alive = probeError?.code === 'EPERM';
                }
            }
            stale = old || !alive;
        } catch {
            try {
                const file = await stat(lockPath);
                stale = Date.now() - file.mtimeMs > 180_000;
            } catch {
                stale = true;
            }
        }
        if (!stale) throw new Error('monitor_locked');
        await unlink(lockPath);
        lock = await open(lockPath, 'wx', 0o600);
    }
    try {
        await lock.writeFile(
            JSON.stringify({
                pid: process.pid,
                createdAt: new Date().toISOString(),
            }),
        );
        return await action();
    } finally {
        await lock.close();
        await unlink(lockPath).catch(() => undefined);
    }
}

function consecutiveFailureCount(previous, publicProbe) {
    return publicProbe.publicStatus >= 500 || publicProbe.publicStatus === 0
        ? previous + 1
        : 0;
}

export async function runMonitor(
    rawConfig,
    {
        now = Date.now(),
        fetcher = fetch,
        publicProbe = probePublishedSite,
        controlProbe = probeControl,
        backupProbe = readBackupEvidence,
        certificateProbe = certificateDaysLeft,
        deliver = deliverNotification,
    } = {},
) {
    const config = validateConfig(rawConfig);
    return withStateLock(config.statePath, async () => {
        let state = await readMonitorState(config.statePath);
        const backup = await backupProbe(config.backup.directory, {
            environment: config.environment,
            lockPath: config.backup.lockPath,
            now,
        });
        const results = [];
        const alerts = [];
        let notificationRetryNeeded = false;

        for (const site of config.sites) {
            const publicProbeResult = await publicProbe(site, { fetcher });
            const control = await controlProbe(config.control, site, fetcher);
            const certificateDays = await certificateProbe(site.origin);
            const owned = state.sites[site.id] ?? {
                alerts: {},
                pending: [],
                deliveryHistory: [],
                consecutiveSlowSamples: 0,
                consecutiveFailures: 0,
            };
            const failures = consecutiveFailureCount(
                owned.consecutiveFailures ?? 0,
                publicProbeResult,
            );
            const slowSamples =
                publicProbeResult.latencyMs > 3_000
                    ? (owned.consecutiveSlowSamples ?? 0) + 1
                    : 0;
            const health = {
                siteId: site.id,
                publicStatus: publicProbeResult.publicStatus,
                latencyMs: publicProbeResult.latencyMs,
                expectedRelease:
                    publicProbeResult.expectedRelease &&
                    (!control.available || control.releaseMatches !== false),
                missingAssets: publicProbeResult.missingAssets,
                certificateDaysLeft: certificateDays,
                backupAgeHours: backup.ageHours,
                backupEvidenceAccepted: backup.accepted,
                consecutiveFailures: failures,
                consecutiveSlowSamples: slowSamples,
                publishFailureCount15m: control.publishFailureCount15m ?? 0,
                controlAvailable: control.available,
                expectedLockedTemplate: backup.lockTemplates.some(
                    (locked) =>
                        locked.id === site.expectedTemplate.id &&
                        locked.version === site.expectedTemplate.version &&
                        locked.manifestChecksum ===
                            site.expectedTemplate.manifestChecksum,
                ),
            };
            const siteAlerts = assessHealth(health);
            const transition = reconcileAlerts(state, site.id, siteAlerts, now);
            state = transition.state;
            state.sites[site.id].consecutiveFailures = failures;
            state.sites[site.id].consecutiveSlowSamples = slowSamples;
            alerts.push(...siteAlerts);
            results.push({
                siteId: site.id,
                public: publicProbeResult,
                control,
                health,
                alerts: siteAlerts,
                recoveryNotifications: transition.notifications.filter(
                    (item) => item.kind === 'recovery',
                ),
            });
        }

        const due = dueNotifications(state, now);
        const deliveries = [];
        for (const notification of due) {
            try {
                if (!config.notification) {
                    deliveries.push({
                        id: notification.id,
                        status: 'monitoring-unconfigured',
                    });
                    notificationRetryNeeded = true;
                    continue;
                }
                await deliver(notification, config, fetcher);
                state = markNotificationDelivered(state, notification.id, now);
                deliveries.push({ id: notification.id, status: 'delivered' });
            } catch (error) {
                const failed = markNotificationFailed(
                    state,
                    notification.id,
                    error,
                    now,
                    config.notification?.retryMs ?? 60_000,
                );
                state = failed.state;
                notificationRetryNeeded = true;
                deliveries.push({
                    id: notification.id,
                    status: 'retry-scheduled',
                    error: String(error?.message ?? error).slice(0, 200),
                });
            }
        }
        state.updatedAt = new Date(now).toISOString();
        await writeMonitorState(config.statePath, state);
        const pending = Object.values(state.sites).reduce(
            (count, site) => count + site.pending.length,
            0,
        );
        const healthy =
            alerts.length === 0 &&
            backup.accepted &&
            !!config.notification &&
            !notificationRetryNeeded &&
            pending === 0;
        return {
            schemaVersion: 1,
            checkedAt: new Date(now).toISOString(),
            environment: config.environment,
            backup,
            sites: results,
            deliveries,
            notification: config.notification?.url ?? 'monitoring-unconfigured',
            pendingNotifications: pending,
            healthy,
            alertCount: alerts.length,
        };
    });
}

export async function loadAndRun(configPath) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    return runMonitor(config);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        const index = process.argv.indexOf('--config');
        const path = index >= 0 ? process.argv[index + 1] : null;
        if (!path) throw new Error('Usage: probe.mjs --config FILE');
        const result = await loadAndRun(path);
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.healthy ? 0 : 1;
    } catch (error) {
        console.log(
            JSON.stringify(
                {
                    schemaVersion: 1,
                    healthy: false,
                    error: 'monitor_failed',
                    message: String(error?.message ?? error).slice(0, 300),
                },
                null,
                2,
            ),
        );
        process.exitCode = 1;
    }
}
