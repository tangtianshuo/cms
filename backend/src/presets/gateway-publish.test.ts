import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gatewayPublishConfig, publishGatewayRelease, type GatewayPublishConfig } from './gateway-publish';
import { buildRelease, type ReleaseSource } from './releases';
import type { ReleaseInput } from './releases';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const siteId = '22222222-2222-4222-8222-222222222222';
const digest = `sha256:${'a'.repeat(64)}`;
const config: GatewayPublishConfig = {
    gatewayBaseUrl: 'http://127.0.0.1:3001', workspaceId, siteId,
    serviceSecret: 'test-secret', manifestChecksum: digest, imageDigest: digest, expectedRevision: 7,
};

function source() {
    const site = { _id: '507f1f77bcf86cd799439011', workspaceId: '507f191e810c19729de860ea',
        status: 'ready', currentReleaseId: '' } as ReleaseInput['site'];
    let activated = false;
    let inserted = false;
    const state: ReleaseSource = {
        findSite: async () => site,
        loadContent: async () => ({}) as Awaited<ReturnType<ReleaseSource['loadContent']>>,
        findRelease: async () => null,
        insertRelease: async () => { inserted = true; },
        activate: async () => { activated = true; return true; },
        audit: async () => undefined,
    };
    return { state, site, get activated() { return activated; }, get inserted() { return inserted; } };
}

const snapshot = { schemaVersion: 1, workspaceId: '507f191e810c19729de860ea',
    siteId: '507f1f77bcf86cd799439011', language: 'en', pages: [], navigation: [], redirects: [] } as ReturnType<typeof buildRelease>;

test('gateway publication uploads UTF-8 snapshot and uses trusted site revision without local activation', async () => {
    const context = source();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        if (calls.length === 1) return Response.json({ releaseId: JSON.parse(String(init?.body)).releaseId }, { status: 201 });
        return Response.json({ id: 'operation-1', status: 'pending' }, { status: 202 });
    };
    const result = await publishGatewayRelease(context.state, 'admin', '', config, fetcher, () => snapshot);
    assert.equal(result.status, 'pending');
    assert.equal(result.operationId, 'operation-1');
    assert.equal(context.activated, false);
    assert.equal(context.inserted, false);
    assert.deepEqual(calls.map((call) => call.url), [
        `${config.gatewayBaseUrl}/api/v1/sites/${siteId}/releases`,
        `${config.gatewayBaseUrl}/api/v1/sites/${siteId}/publish-operations`,
    ]);
    const release = JSON.parse(String(calls[0].init.body));
    const bytes = Buffer.from(release.snapshot, 'base64');
    assert.equal(release.checksum, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), { ...snapshot, workspaceId, siteId });
    assert.deepEqual(release.metadata, { templateId: 'aeroframe', templateVersion: '1.0.0',
        manifestChecksum: digest, imageDigest: digest });
    assert.equal(release.siteId, siteId);
    assert.match(release.releaseId, /^[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(String(calls[1].init.body)).expectedRevision, 7);
    assert.equal(JSON.parse(String(calls[1].init.body)).releaseId, release.releaseId);
    assert.ok(JSON.parse(String(calls[1].init.body)).idempotencyKey);
    assert.equal(calls[1].init.headers && (calls[1].init.headers as Record<string, string>).Authorization, 'Bearer test-secret');
});

test('invalid gateway binding is rejected before HTTP and cannot reuse CMS ObjectId', async () => {
    const context = source();
    let requests = 0;
    await assert.rejects(() => publishGatewayRelease(context.state, 'admin', '',
        { ...config, siteId: context.site._id }, async () => { requests++; return Response.json({}); }, () => snapshot), /UUID|siteId/i);
    await assert.rejects(() => publishGatewayRelease(context.state, 'admin', '',
        { ...config, imageDigest: 'latest' }, async () => { requests++; return Response.json({}); }, () => snapshot), /imageDigest/i);
    assert.equal(requests, 0);
});

test('invalid or missing configured revision is rejected before HTTP', async () => {
    const context = source();
    let requests = 0;
    for (const value of ['', '1.5', '-1', '1e2', '9007199254740992']) {
        const bad = gatewayPublishConfig({ GATEWAY_EXPECTED_REVISION: value });
        await assert.rejects(() => publishGatewayRelease(context.state, 'admin', '',
            { ...config, expectedRevision: bad.expectedRevision }, async () => { requests++; return Response.json({}); },
            () => snapshot), /GATEWAY_EXPECTED_REVISION/);
    }
    assert.equal(requests, 0);
});

test('gateway revision conflict does not activate local site', async () => {
    const context = source();
    await assert.rejects(() => publishGatewayRelease(context.state, 'admin', '', config,
        async (_url, init) => init?.method === 'POST' && String(_url).endsWith('/releases')
            ? Response.json({}, { status: 201 }) : Response.json({ error: 'conflict' }, { status: 409 }),
        () => snapshot), /Gateway revision conflict/);
    assert.equal(context.activated, false);
    assert.equal(context.inserted, false);
});
