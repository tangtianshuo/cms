import assert from 'node:assert/strict';
import test from 'node:test';
import { runPublishFairness } from './publish-fairness.mjs';

test('enqueues stable per-site revisions and observes both sites being claimed', async () => {
    const revisions = new Map([
        ['11111111-1111-4111-8111-111111111111', 0],
        ['22222222-2222-4222-8222-222222222222', 4],
    ]);
    const operations = new Map();
    const fetcher = async (url, init = {}) => {
        if (init.method === 'POST') {
            const body = JSON.parse(init.body);
            const siteId = new URL(url).pathname.split('/').at(-2);
            assert.equal(body.expectedRevision, revisions.get(siteId));
            const desiredRevision = body.expectedRevision + 1;
            revisions.set(siteId, desiredRevision);
            const id = `${siteId}-${desiredRevision}`;
            operations.set(id, siteId);
            return Response.json(
                {
                    id,
                    releaseId: body.releaseId,
                    expectedRevision: body.expectedRevision,
                    desiredRevision,
                    status: 'pending',
                },
                { status: 201 },
            );
        }
        const id = new URL(url).pathname.split('/').at(-1);
        assert.ok(operations.has(id));
        return Response.json({ id, attempts: 1, status: 'pending' });
    };
    const result = await runPublishFairness({
        controlOrigin: 'http://127.0.0.1:4000',
        token: 'fixture-token',
        fetcher,
        waitMs: 1_000,
        pollMs: 100,
        sites: [
            {
                siteId: '11111111-1111-4111-8111-111111111111',
                releaseId: 'release-a',
                expectedRevision: 0,
                count: 20,
            },
            {
                siteId: '22222222-2222-4222-8222-222222222222',
                releaseId: 'release-b',
                expectedRevision: 4,
                count: 1,
            },
        ],
    });
    assert.equal(result.accepted, 21);
    assert.equal(result.unexpected, 0);
    assert.equal(result.allSitesClaimed, true);
    assert.deepEqual(
        result.siteBudgets.map((item) => [item.accepted, item.limited]),
        [
            [20, 0],
            [1, 0],
        ],
    );
});

test('reports exact 429 Retry-After responses', async () => {
    const result = await runPublishFairness({
        controlOrigin: 'http://127.0.0.1:4000',
        token: 'fixture-token',
        fetcher: async () =>
            Response.json(
                {
                    error: 'publish_quota_exceeded',
                    scope: 'workspace',
                    retryAfterSeconds: 5,
                },
                { status: 429, headers: { 'Retry-After': '5' } },
            ),
        sites: [
            {
                siteId: '11111111-1111-4111-8111-111111111111',
                releaseId: 'release-a',
                expectedRevision: 0,
                count: 1,
            },
            {
                siteId: '22222222-2222-4222-8222-222222222222',
                releaseId: 'release-b',
                expectedRevision: 0,
                count: 1,
            },
        ],
    });
    assert.equal(result.limited, 2);
    assert.equal(result.quotaHeadersValid, true);
});
