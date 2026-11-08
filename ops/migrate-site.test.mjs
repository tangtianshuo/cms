import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const runFile = promisify(execFile);
const requestKey = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const sourceChecksum = `sha256:${'a'.repeat(64)}`;

test('CLI plans, applies and rolls back one explicit site', async () => {
    const calls = [];
    const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
            : null;
        calls.push({ method: request.method, url: request.url, body });
        response.setHeader('content-type', 'application/json');
        if (request.url === '/api/v4/presets/migrations/legacy/plan') {
            response.end(
                JSON.stringify({
                    operationId,
                    siteId: 'site-a',
                    sourceChecksum,
                    status: 'staged',
                }),
            );
            return;
        }
        if (
            request.method === 'GET' &&
            request.url === `/api/v4/presets/migrations/${operationId}`
        ) {
            response.end(
                JSON.stringify({
                    id: operationId,
                    cmsSiteId: 'site-a',
                    sourceChecksum,
                }),
            );
            return;
        }
        if (request.url.endsWith('/legacy/apply')) {
            response.end(
                JSON.stringify({
                    id: operationId,
                    cmsSiteId: 'site-a',
                    status: 'active',
                }),
            );
            return;
        }
        if (request.url.endsWith('/rollback')) {
            response.end(
                JSON.stringify({
                    id: operationId,
                    cmsSiteId: 'site-a',
                    status: 'rolled-back',
                }),
            );
            return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'not_found' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const env = {
        ...process.env,
        CMS_ADMIN_TOKEN: 'fixture-token',
        CMS_MIGRATION_API_BASE: `http://127.0.0.1:${address.port}/api/v4/presets`,
    };
    try {
        const plan = JSON.parse(
            (
                await runFile(
                    process.execPath,
                    [
                        'ops/migrate-site.mjs',
                        'plan',
                        '--site',
                        'site-a',
                        '--request-key',
                        requestKey,
                    ],
                    { cwd: process.cwd(), env, encoding: 'utf8' },
                )
            ).stdout,
        );
        assert.equal(plan.operationId, operationId);
        const applied = JSON.parse(
            (
                await runFile(
                    process.execPath,
                    [
                        'ops/migrate-site.mjs',
                        'apply',
                        '--site',
                        'site-a',
                        '--operation',
                        operationId,
                    ],
                    { cwd: process.cwd(), env, encoding: 'utf8' },
                )
            ).stdout,
        );
        assert.equal(applied.status, 'active');
        const rolledBack = JSON.parse(
            (
                await runFile(
                    process.execPath,
                    [
                        'ops/migrate-site.mjs',
                        'rollback',
                        '--site',
                        'site-a',
                        '--operation',
                        operationId,
                    ],
                    { cwd: process.cwd(), env, encoding: 'utf8' },
                )
            ).stdout,
        );
        assert.equal(rolledBack.status, 'rolled-back');
        assert.deepEqual(
            calls
                .filter((call) => call.method === 'POST')
                .map((call) => call.body),
            [
                { siteId: 'site-a', requestKey },
                { siteId: 'site-a', sourceChecksum },
                {},
            ],
        );
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
});
