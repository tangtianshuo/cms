import assert from 'node:assert/strict';
import test from 'node:test';
import { runPublishFairness } from './publish-fairness.mjs';

const workspaces = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
const sites = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
].map((siteId, index) => ({
    siteId,
    workspaceId: workspaces[index < 2 ? 0 : 1],
    releaseId: `release-${index}`,
    expectedRevision: index,
    count: 2,
    token: `workspace-token-${index < 2 ? 'a' : 'b'}`,
}));
const healthyProbes = [
    {
        siteId: sites[0].siteId,
        url: 'https://healthy.example/',
        marker: 'healthy-current',
    },
];

test('observes all four sites across two workspaces without a false early success', async () => {
    const revisions = new Map(
        sites.map((site) => [site.siteId, site.expectedRevision]),
    );
    const operations = new Map();
    let polls = 0;
    const fetcher = async (url, init = {}) => {
        if (url.startsWith('https://healthy.example/')) {
            return new Response('<main>healthy-current</main>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            });
        }
        if (init.method === 'POST') {
            const siteId = new URL(url).pathname.split('/').at(-2);
            const body = JSON.parse(init.body);
            assert.equal(body.expectedRevision, revisions.get(siteId));
            assert.match(
                init.headers.authorization,
                /^Bearer workspace-token-/,
            );
            const desiredRevision = body.expectedRevision + 1;
            revisions.set(siteId, desiredRevision);
            const id = `${siteId}-${desiredRevision}`;
            operations.set(id, { siteId, attempts: 0 });
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
        const operation = operations.get(id);
        assert.ok(operation);
        polls += 1;
        if (polls >= 8) operation.attempts = 1;
        return Response.json({
            id,
            attempts: operation.attempts,
            status: 'pending',
        });
    };
    let restarted = false;
    let expired = false;
    const result = await runPublishFairness({
        controlOrigin: 'http://127.0.0.1:4000',
        sites,
        healthyProbes,
        fetcher,
        waitMs: 2_000,
        pollMs: 100,
        restartWorkers: async () => {
            restarted = true;
        },
        expireLease: async ({ operationId, siteId }) => {
            assert.ok(operations.has(operationId));
            assert.equal(operations.get(operationId).siteId, siteId);
            expired = true;
        },
    });
    assert.equal(result.accepted, 8);
    assert.equal(result.unexpected, 0);
    assert.equal(result.allSitesClaimed, true);
    assert.equal(result.healthyContinuity, true);
    assert.equal(result.workerRestartInvoked, true);
    assert.equal(result.leaseExpirationInvoked, true);
    assert.equal(result.success, true);
    assert.equal(restarted, true);
    assert.equal(expired, true);
    assert.equal(result.workspaceBudgets.length, 2);
    assert.deepEqual(
        result.workspaceBudgets.map((item) => [
            item.accepted,
            item.claimedSites,
        ]),
        [
            [4, 2],
            [4, 2],
        ],
    );
});

test('reports exact 429 Retry-After and does not report success', async () => {
    const result = await runPublishFairness({
        controlOrigin: 'http://127.0.0.1:4000',
        sites: sites.slice(0, 2).map((site, index) => ({
            ...site,
            workspaceId: workspaces[index],
        })),
        healthyProbes,
        fetcher: async (url) =>
            url.startsWith('https://healthy.example/')
                ? new Response('<main>healthy-current</main>', {
                      status: 200,
                  })
                : Response.json(
                      {
                          error: 'publish_quota_exceeded',
                          scope: 'workspace',
                          retryAfterSeconds: 5,
                      },
                      { status: 429, headers: { 'Retry-After': '5' } },
                  ),
        waitMs: 1_000,
        pollMs: 1_000,
    });
    assert.equal(result.limited, 2);
    assert.equal(result.quotaHeadersValid, true);
    assert.equal(result.allSitesClaimed, false);
    assert.equal(result.success, false);
});

test('rejects a drill that disables observation', async () => {
    await assert.rejects(
        () =>
            runPublishFairness({
                controlOrigin: 'http://127.0.0.1:4000',
                sites,
                healthyProbes,
                waitMs: 0,
            }),
        /observation/,
    );
});
