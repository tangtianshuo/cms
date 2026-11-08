#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSite(value) {
    const [siteId, releaseId, expectedRevision, count] = value.split(':');
    if (
        !uuid.test(siteId) ||
        !releaseId ||
        !Number.isSafeInteger(Number(expectedRevision)) ||
        Number(expectedRevision) < 0 ||
        !Number.isSafeInteger(Number(count)) ||
        Number(count) < 1 ||
        Number(count) > 100
    ) {
        throw new TypeError(
            '--site must be SITE_UUID:RELEASE_ID:EXPECTED_REVISION:COUNT',
        );
    }
    return {
        siteId,
        releaseId,
        expectedRevision: Number(expectedRevision),
        count: Number(count),
    };
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

export async function runPublishFairness({
    controlOrigin,
    token,
    sites,
    fetcher = fetch,
    waitMs = 0,
    pollMs = 1_000,
}) {
    const base = origin(controlOrigin);
    if (typeof token !== 'string' || !token || token.length > 4_096)
        throw new TypeError('Token is required');
    if (!Array.isArray(sites) || sites.length < 2)
        throw new TypeError('At least two sites are required');
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
                            authorization: `Bearer ${token}`,
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
    const deadline = Date.now() + waitMs;
    let observations = [];
    if (waitMs > 0) {
        do {
            observations = await Promise.all(
                accepted.map(async (item) => {
                    const response = await fetcher(
                        `${base}/api/v1/sites/${item.siteId}/publish-operations/${item.operationId}`,
                        { headers: { authorization: `Bearer ${token}` } },
                    );
                    return {
                        siteId: item.siteId,
                        status: response.status,
                        body:
                            response.status === 200
                                ? await response.json()
                                : null,
                    };
                }),
            );
            if (
                observations.some(
                    (item) =>
                        item.status === 200 && Number(item.body?.attempts) > 0,
                )
            )
                break;
            if (Date.now() >= deadline) break;
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(pollMs, deadline - Date.now())),
            );
        } while (Date.now() < deadline);
    }

    const siteBudgets = sites.map((site) => ({
        siteId: site.siteId,
        accepted: accepted.filter((item) => item.siteId === site.siteId).length,
        limited: limited.filter((item) => item.siteId === site.siteId).length,
    }));
    const allSitesClaimed = sites.every((site) =>
        observations.some(
            (item) =>
                item.siteId === site.siteId &&
                item.status === 200 &&
                Number(item.body?.attempts) > 0,
        ),
    );
    return {
        schemaVersion: 1,
        controlOrigin: base,
        siteBudgets,
        accepted: accepted.length,
        limited: limited.length,
        unexpected: unexpected.length,
        quotaHeadersValid: limited.every(
            (item) =>
                item.retryAfter === '5' &&
                item.error === 'publish_quota_exceeded',
        ),
        observations,
        allSitesClaimed: waitMs > 0 ? allSitesClaimed : null,
    };
}

function parseArgs(argv) {
    const values = { sites: [], waitMs: 0, pollMs: 1_000 };
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!value) throw new TypeError(`Missing value for ${name}`);
        index += 1;
        if (name === '--control-origin') values.controlOrigin = value;
        else if (name === '--site') values.sites.push(parseSite(value));
        else if (name === '--wait-ms') values.waitMs = Number(value);
        else if (name === '--poll-ms') values.pollMs = Number(value);
        else throw new TypeError(`Unknown argument: ${name}`);
    }
    if (
        !values.controlOrigin ||
        values.sites.length < 2 ||
        !Number.isSafeInteger(values.waitMs) ||
        values.waitMs < 0 ||
        values.waitMs > 600_000 ||
        !Number.isSafeInteger(values.pollMs) ||
        values.pollMs < 100 ||
        values.pollMs > 60_000
    ) {
        throw new TypeError(
            'Provide --control-origin and at least two --site specifications',
        );
    }
    if (!process.env.CMS_SERVICE_SECRET)
        throw new TypeError('CMS_SERVICE_SECRET is required');
    return values;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        const values = parseArgs(process.argv.slice(2));
        const result = await runPublishFairness({
            ...values,
            token: process.env.CMS_SERVICE_SECRET,
        });
        console.log(JSON.stringify(result, null, 2));
        if (
            result.unexpected ||
            !result.quotaHeadersValid ||
            result.accepted === 0 ||
            result.allSitesClaimed === false
        ) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error(
            JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            }),
        );
        process.exitCode = 2;
    }
}
