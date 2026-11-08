#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const actions = new Set(['plan', 'apply', 'rollback']);

function required(value, name) {
    if (typeof value !== 'string' || !value)
        throw new Error(`${name} is required`);
    return value;
}

export function parseMigrateArgs(argv) {
    const [action, ...rest] = argv;
    if (!actions.has(action))
        throw new Error(
            'usage: migrate-site.mjs plan|apply|rollback --site ID [--operation ID]',
        );
    const values = {};
    for (let index = 0; index < rest.length; index += 2) {
        const flag = rest[index];
        const value = rest[index + 1];
        if (
            !['--site', '--operation', '--request-key'].includes(flag) ||
            !value
        )
            throw new Error(`Invalid argument ${flag || ''}`.trim());
        if (values[flag] !== undefined)
            throw new Error(`Duplicate argument ${flag}`);
        values[flag] = value;
    }
    const site = required(values['--site'], '--site');
    if (action !== 'plan') required(values['--operation'], '--operation');
    if (
        values['--operation'] &&
        !/^[0-9a-f-]{36}$/i.test(values['--operation'])
    )
        throw new Error('--operation must be an operation UUID');
    if (
        values['--request-key'] &&
        !/^[0-9a-f-]{36}$/i.test(values['--request-key'])
    )
        throw new Error('--request-key must be a UUID');
    return {
        action,
        site,
        ...(values['--operation'] ? { operation: values['--operation'] } : {}),
        ...(values['--request-key']
            ? { requestKey: values['--request-key'] }
            : {}),
    };
}

function apiBase() {
    const value =
        process.env.CMS_MIGRATION_API_BASE ||
        'http://127.0.0.1:8080/api/v4/presets';
    const url = new URL(value);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
        (url.protocol !== 'https:' &&
            !(url.protocol === 'http:' && loopback)) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw new Error(
            'CMS_MIGRATION_API_BASE must be HTTPS or credential-free loopback HTTP',
        );
    return url.href.replace(/\/$/, '');
}

async function request(path, options = {}) {
    const token = required(process.env.CMS_ADMIN_TOKEN, 'CMS_ADMIN_TOKEN');
    const response = await fetch(`${apiBase()}${path}`, {
        ...options,
        signal: AbortSignal.timeout(
            Number(process.env.CMS_MIGRATION_TIMEOUT_MS || 30_000),
        ),
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(options.headers || {}),
        },
    });
    let body;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok)
        throw new Error(`CMS migration request failed (${response.status})`);
    return body;
}

async function operationFor(id, site) {
    const operation = await request(`/migrations/${encodeURIComponent(id)}`);
    if (!operation || operation.cmsSiteId !== site)
        throw new Error('Migration operation does not belong to --site');
    return operation;
}

async function main() {
    const args = parseMigrateArgs(process.argv.slice(2));
    if (args.action === 'plan') {
        return request('/migrations/legacy/plan', {
            method: 'POST',
            body: JSON.stringify({
                siteId: args.site,
                requestKey: args.requestKey || randomUUID(),
            }),
        });
    }
    const operation = await operationFor(args.operation, args.site);
    if (args.action === 'rollback') {
        const result = await request(
            `/migrations/${encodeURIComponent(args.operation)}/rollback`,
            { method: 'POST', body: '{}' },
        );
        if (result.cmsSiteId !== args.site)
            throw new Error('Rollback response changed site identity');
        return result;
    }
    return request(
        `/migrations/${encodeURIComponent(args.operation)}/legacy/apply`,
        {
            method: 'POST',
            body: JSON.stringify({
                siteId: args.site,
                sourceChecksum: operation.sourceChecksum,
            }),
        },
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        console.log(JSON.stringify(await main()));
    } catch (error) {
        console.error(
            error instanceof Error ? error.message : 'Migration failed',
        );
        process.exitCode = 1;
    }
}
