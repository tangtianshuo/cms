#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSite(value) {
    const [siteId, releaseId, expectedRevision, count, tokenEnv, workspaceId] =
        value.split(':');
    if (
        !uuid.test(siteId) ||
        !uuid.test(workspaceId) ||
        !releaseId ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv) ||
        !Number.isSafeInteger(Number(expectedRevision)) ||
        Number(expectedRevision) < 0 ||
        !Number.isSafeInteger(Number(count)) ||
        Number(count) < 1 ||
        Number(count) > 100
    ) {
        throw new TypeError(
            '--site must be SITE_UUID:RELEASE_ID:EXPECTED_REVISION:COUNT:TOKEN_ENV:WORKSPACE_UUID',
        );
    }
    return {
        siteId,
        releaseId,
        workspaceId,
        tokenEnv,
        expectedRevision: Number(expectedRevision),
        count: Number(count),
    };
}

function parseHealthy(value) {
    const first = value.indexOf(':');
    const last = value.lastIndexOf(':');
    if (first < 1 || last <= first + 1) {
        throw new TypeError('--healthy must be SITE_UUID:URL:MARKER');
    }
    const siteId = value.slice(0, first);
    const url = new URL(value.slice(first + 1, last));
    const marker = value.slice(last + 1);
    if (
        !uuid.test(siteId) ||
        !marker ||
        marker.length > 2_048 ||
        url.username ||
        url.password ||
        url.hash ||
        !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(url.hostname))
        )
    ) {
        throw new TypeError(
            '--healthy must use a safe URL and non-empty marker',
        );
    }
    return { siteId, url: url.href, marker };
}

function origin(value) {
    const url = new URL(value);
    if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
                ['localhost', '127.0.0.1'].includes(url.hostname))
        )
    ) {
        throw new TypeError(
            'Gateway origin must be credential-free HTTPS or loopback HTTP',
        );
    }
    return url.origin;
}

function siteToken(site, fallbackToken) {
    const token =
        site.token ??
        (site.tokenEnv ? process.env[site.tokenEnv] : undefined) ??
        fallbackToken;
    if (typeof token !== 'string' || !token || token.length > 4_096) {
        throw new TypeError(
            `A valid credential is required for site ${site.siteId}`,
        );
    }
    return token;
}

async function probeHealthySites(probes, fetcher, evidence) {
    if (!probes.length) return;
    const samples = await Promise.all(
        probes.map(async (probe) => {
            try {
                const response = await fetcher(probe.url, {
                    headers: {
                        accept: 'text/html,application/xhtml+xml',
                        'cache-control': 'no-cache',
                    },
                    redirect: 'manual',
                });
                const body = await response.text();
                return {
                    siteId: probe.siteId,
                    status: response.status,
                    markerPresent: body.includes(probe.marker),
                    ok: response.status === 200 && body.includes(probe.marker),
                };
            } catch (error) {
                return {
                    siteId: probe.siteId,
                    status: 0,
                    markerPresent: false,
                    ok: false,
                    error: String(error?.message ?? error).slice(0, 160),
                };
            }
        }),
    );
    evidence.healthySamples.push(...samples);
}

export async function runPublishFairness({
    controlOrigin,
    token,
    sites,
    healthyProbes = [],
    fetcher = fetch,
    healthFetcher = fetcher,
    waitMs = 30_000,
    pollMs = 1_000,
    restartWorkers,
    expireLease,
}) {
    const base = origin(controlOrigin);
    if (!Array.isArray(sites) || sites.length < 2)
        throw new TypeError('At least two sites are required');
    if (
        !Number.isSafeInteger(waitMs) ||
        waitMs < 1_000 ||
        waitMs > 600_000 ||
        !Number.isSafeInteger(pollMs) ||
        pollMs < 100 ||
        pollMs > 60_000
    )
        throw new TypeError('waitMs/pollMs must require bounded observation');
    if (new Set(sites.map((site) => site.workspaceId ?? 'default')).size < 2) {
        throw new TypeError('Fairness drill requires at least two workspaces');
    }
    for (const site of sites) {
        if (
            !uuid.test(site.siteId) ||
            !Number.isSafeInteger(site.count) ||
            site.count < 1 ||
            typeof site.releaseId !== 'string' ||
            !site.releaseId
        )
            throw new TypeError('Invalid site specification');
        siteToken(site, token);
    }
    if (!Array.isArray(healthyProbes) || healthyProbes.length < 1)
        throw new TypeError(
            'At least one healthy active site probe is required',
        );

    const evidence = { healthySamples: [] };
    const enqueued = [];
    await Promise.all(
        sites.map(async (site) => {
            let revision = site.expectedRevision;
            for (let index = 0; index < site.count; index += 1) {
                const response = await fetcher(
                    `${base}/api/v1/sites/${site.siteId}/publish-operations`,
                    {
                        method: 'POST',
                        headers: {
                            authorization: `Bearer ${siteToken(site, token)}`,
                            'content-type': 'application/json',
                        },
                        body: JSON.stringify({
                            releaseId: site.releaseId,
                            idempotencyKey: `fairness-${site.siteId}-${randomUUID()}`,
                            expectedRevision: revision,
                        }),
                    },
                );
                const body = await response.json();
                enqueued.push({
                    siteId: site.siteId,
                    workspaceId: site.workspaceId ?? 'default',
                    status: response.status,
                    retryAfter: response.headers.get('retry-after'),
                    operationId: typeof body?.id === 'string' ? body.id : null,
                    error: typeof body?.error === 'string' ? body.error : null,
                });
                if (
                    (response.status === 200 || response.status === 201) &&
                    Number.isSafeInteger(body?.desiredRevision)
                ) {
                    revision = body.desiredRevision;
                } else {
                    break;
                }
            }
        }),
    );

    const accepted = enqueued.filter(
        (item) => item.status === 200 || item.status === 201,
    );
    const limited = enqueued.filter((item) => item.status === 429);
    const unexpected = enqueued.filter(
        (item) =>
            item.status !== 200 && item.status !== 201 && item.status !== 429,
    );
    await probeHealthySites(healthyProbes, healthFetcher, evidence);
    let workerRestartInvoked = false;
    if (restartWorkers) {
        await restartWorkers();
        workerRestartInvoked = true;
    }
    let leaseExpirationInvoked = false;
    if (expireLease && accepted.length) {
        await expireLease({
            siteId: accepted[0].siteId,
            operationId: accepted[0].operationId,
        });
        leaseExpirationInvoked = true;
    }

    const deadline = Date.now() + waitMs;
    let observations = [];
    do {
        observations = await Promise.all(
            accepted.map(async (item) => {
                const response = await fetcher(
                    `${base}/api/v1/sites/${item.siteId}/publish-operations/${item.operationId}`,
                    {
                        headers: {
                            authorization: `Bearer ${siteToken(
                                sites.find(
                                    (site) => site.siteId === item.siteId,
                                ),
                                token,
                            )}`,
                        },
                    },
                );
                return {
                    siteId: item.siteId,
                    status: response.status,
                    body:
                        response.status === 200 ? await response.json() : null,
                };
            }),
        );
        await probeHealthySites(healthyProbes, healthFetcher, evidence);
        const claimedSites = new Set(
            observations
                .filter(
                    (item) =>
                        item.status === 200 && Number(item.body?.attempts) > 0,
                )
                .map((item) => item.siteId),
        );
        if (sites.every((site) => claimedSites.has(site.siteId))) break;
        if (Date.now() >= deadline) break;
        await new Promise((resolve) =>
            setTimeout(resolve, Math.min(pollMs, deadline - Date.now())),
        );
    } while (Date.now() < deadline);

    const claimedSites = new Set(
        observations
            .filter(
                (item) =>
                    item.status === 200 && Number(item.body?.attempts) > 0,
            )
            .map((item) => item.siteId),
    );
    const siteBudgets = sites.map((site) => ({
        siteId: site.siteId,
        workspaceId: site.workspaceId ?? 'default',
        accepted: accepted.filter((item) => item.siteId === site.siteId).length,
        limited: limited.filter((item) => item.siteId === site.siteId).length,
        claimed: claimedSites.has(site.siteId),
    }));
    const workspaceBudgets = Object.values(
        siteBudgets.reduce((result, item) => {
            result[item.workspaceId] ??= {
                workspaceId: item.workspaceId,
                accepted: 0,
                limited: 0,
                claimedSites: 0,
            };
            result[item.workspaceId].accepted += item.accepted;
            result[item.workspaceId].limited += item.limited;
            result[item.workspaceId].claimedSites += item.claimed ? 1 : 0;
            return result;
        }, {}),
    );
    const healthyContinuity =
        evidence.healthySamples.length > 1 &&
        evidence.healthySamples.every((sample) => sample.ok);
    const allSitesClaimed = sites.every((site) =>
        claimedSites.has(site.siteId),
    );
    return {
        schemaVersion: 1,
        controlOrigin: base,
        siteBudgets,
        workspaceBudgets,
        accepted: accepted.length,
        limited: limited.length,
        unexpected: unexpected.length,
        quotaHeadersValid: limited.every(
            (item) =>
                item.retryAfter === '5' &&
                item.error === 'publish_quota_exceeded',
        ),
        observations,
        healthySamples: evidence.healthySamples,
        healthyContinuity,
        workerRestartInvoked,
        leaseExpirationInvoked,
        allSitesClaimed,
        success:
            unexpected.length === 0 &&
            limited.every(
                (item) =>
                    item.retryAfter === '5' &&
                    item.error === 'publish_quota_exceeded',
            ) &&
            allSitesClaimed &&
            healthyContinuity,
    };
}

function parseArgs(argv) {
    const values = {
        sites: [],
        healthyProbes: [],
        waitMs: 30_000,
        pollMs: 1_000,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!value) throw new TypeError(`Missing value for ${name}`);
        index += 1;
        if (name === '--control-origin') values.controlOrigin = value;
        else if (name === '--site') values.sites.push(parseSite(value));
        else if (name === '--healthy')
            values.healthyProbes.push(parseHealthy(value));
        else if (name === '--wait-ms') values.waitMs = Number(value);
        else if (name === '--poll-ms') values.pollMs = Number(value);
        else throw new TypeError(`Unknown argument: ${name}`);
    }
    if (
        !values.controlOrigin ||
        values.sites.length < 2 ||
        values.healthyProbes.length < 1
    ) {
        throw new TypeError(
            'Provide --control-origin, at least two --site entries and at least one --healthy probe',
        );
    }
    return values;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        const values = parseArgs(process.argv.slice(2));
        const result = await runPublishFairness(values);
        console.log(JSON.stringify(result, null, 2));
        if (!result.success) process.exitCode = 1;
    } catch (error) {
        console.error(
            JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            }),
        );
        process.exitCode = 2;
    }
}
