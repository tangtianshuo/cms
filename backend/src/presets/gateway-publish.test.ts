import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gatewayPublishConfig, publishGatewayRelease, type GatewayPublishConfig, type GatewayReleaseSource } from './gateway-publish';
import type { ReleaseSnapshot } from './releases';
import type { SiteInstallation } from './site-model';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const gatewaySiteId = '22222222-2222-4222-8222-222222222222';
const cmsSiteId = '507f1f77bcf86cd799439011';
const digest = `sha256:${'a'.repeat(64)}`;
const record = { schemaVersion: 1, id: 'aeroframe', version: '1.0.1', manifestChecksum: digest,
    imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
    imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40),
    manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available' };
const config: GatewayPublishConfig = {
    gatewayBaseUrl: 'http://127.0.0.1:3001', workspaceId, siteId: gatewaySiteId, serviceSecret: 'test-secret',
    cmsWorkspaceId: 'default', cmsSiteId, siteUrl: 'https://shop.example.com',
};
const requestKey = '33333333-3333-4333-8333-333333333333';
const snapshot = { schemaVersion: 1, workspaceId: '507f191e810c19729de860ea', siteId: cmsSiteId,
    language: 'en', pages: [], navigation: [], redirects: [] } as ReleaseSnapshot;

function harness(options: { advanceStoredTimestamp?: boolean } = {}) {
    const site: SiteInstallation = { _id: cmsSiteId, workspaceId: 'default', createdAt: 1, updatedAt: 2,
        slot: 'default', name: 'Test', presetId: 'aeroframe', presetVersion: '1.0.1', status: 'ready',
        importError: '', includeDemo: false, demoSeeded: false,
        theme: { background: '#000000', foreground: '#ffffff', accent: '#111111', muted: '#222222', font: 'Arial, sans-serif' },
        models: [], pages: [], presetManifestSnapshot: JSON.stringify({ id: 'aeroframe', version: '1.0.1' }),
        publishedTemplateRecord: JSON.stringify(record), currentReleaseId: '' };
    const state: GatewayReleaseSource = {
        findSite: async () => site,
        loadContent: async () => ({}) as Awaited<ReturnType<GatewayReleaseSource['loadContent']>>,
        findRelease: async () => null,
        insertRelease: async () => undefined,
        activate: async () => { throw new Error('Gateway publication must not activate local state'); },
        audit: async () => undefined,
        saveSite: async (updated, expected) => {
            if (site.updatedAt !== expected) return false;
            if (options.advanceStoredTimestamp) updated.updatedAt = Math.max(Date.now() + 5, expected + 1);
            Object.assign(site, updated);
            return true;
        },
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        if (String(url).endsWith('/template-pin')) return Response.json({ ...record, templateId: record.id, templateVersion: record.version });
        if (String(url).endsWith(`/api/v1/sites/${gatewaySiteId}`)) return Response.json({ revision: 9 });
        if (String(url).endsWith('/releases')) return Response.json({ releaseId: JSON.parse(String(init?.body)).releaseId }, { status: 201 });
        if (String(url).endsWith('/publish-operations')) return Response.json({ id: 'operation-1', status: 'pending', revision: 10 }, { status: 202 });
        throw new Error(`Unexpected Gateway URL: ${String(url)}`);
    };
    return { site, state, calls, fetcher };
}

test('Gateway publication pins the persisted version, reads revision and persists a stable intent', async () => {
    const h = harness();
    const result = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    assert.deepEqual(result, { releaseId: result.releaseId, operationId: 'operation-1', status: 'pending' });
    const intent = JSON.parse(h.site.gatewayPublishIntent || '{}');
    assert.equal(intent.requestKey, requestKey);
    assert.equal(intent.operationId, 'operation-1');
    assert.equal(intent.revision, 9);
    const bytes = Buffer.from(intent.snapshot, 'base64');
    assert.equal(intent.checksum, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), { ...snapshot, workspaceId, siteId: gatewaySiteId });
    const release = JSON.parse(String(h.calls.find((call) => call.url.endsWith('/releases'))?.init.body));
    assert.deepEqual(release.metadata, { templateId: record.id, templateVersion: record.version,
        manifestChecksum: record.manifestChecksum, imageDigest: record.imageDigest,
        imageRepository: record.imageRepository, sourceCommit: record.sourceCommit });
    assert.equal(h.calls.find((call) => call.url.endsWith('/publish-operations'))?.init.headers &&
        (h.calls.find((call) => call.url.endsWith('/publish-operations'))?.init.headers as Record<string, string>).Authorization, 'Bearer test-secret');
});

test('same request key reuses the exact release intent without additional Gateway writes', async () => {
    const h = harness();
    const first = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    const callCount = h.calls.length;
    const editedSnapshot = { ...snapshot, pages: [{ path: '/', pageKey: 'home', entryId: 'edited', content: {} }] } as ReleaseSnapshot;
    const second = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => editedSnapshot);
    assert.deepEqual(second, first);
    assert.equal(h.calls.length, callCount);
    const saved = JSON.parse(h.site.gatewayPublishIntent || '{}');
    assert.equal(saved.requestKey, requestKey);
    assert.equal(saved.releaseId, first.releaseId);
    assert.deepEqual(saved.record, record);
    assert.deepEqual(JSON.parse(Buffer.from(saved.snapshot, 'base64').toString('utf8')), { ...snapshot, workspaceId, siteId: gatewaySiteId });
});

test('publication carries the timestamp returned by each CAS save into the next save', async () => {
    const h = harness({ advanceStoredTimestamp: true });
    const result = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    assert.equal(result.operationId, 'operation-1');
    assert.equal(JSON.parse(h.site.gatewayPublishIntent || '{}').status, 'pending');
    assert.equal(h.site.updatedAt > 2, true);
});

test('a persisted request key cannot be retried with a changed immutable record for the same version', async () => {
    const h = harness();
    await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    const savedIntent = JSON.parse(h.site.gatewayPublishIntent || '{}');
    h.site.gatewayPublishIntent = JSON.stringify({ ...savedIntent, status: 'ready' });
    const changedRecord = { ...record, imageDigest: `sha256:${'d'.repeat(64)}` };
    h.site.publishedTemplateRecord = JSON.stringify(changedRecord);
    h.site.gatewayPinnedTemplateRecord = JSON.stringify({ ...changedRecord, templateId: record.id, templateVersion: record.version });
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', '44444444-4444-4444-8444-444444444444',
        config, h.fetcher, () => snapshot), /immutable|record|version/i);
});

test('Gateway revision conflict becomes terminal and a new explicit action reads a fresh revision', async () => {
    const h = harness();
    let revision = 9;
    let operationAttempt = 0;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value.endsWith('/template-pin')) return Response.json({ ...record, templateId: record.id, templateVersion: record.version });
        if (value.endsWith(`/api/v1/sites/${gatewaySiteId}`)) return Response.json({ revision });
        if (value.endsWith('/releases')) return Response.json({}, { status: 201 });
        if (value.endsWith('/publish-operations')) {
            operationAttempt++;
            if (operationAttempt === 1) { revision = 10; return Response.json({ error: 'conflict' }, { status: 409 }); }
            assert.equal(JSON.parse(String(init?.body)).expectedRevision, 10);
            return Response.json({ id: 'operation-2', status: 'pending' }, { status: 202 });
        }
        throw new Error(`Unexpected URL ${value}`);
    };
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, fetcher, () => snapshot), /concurrent change/i);
    const failed = JSON.parse(h.site.gatewayPublishIntent || '{}');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureCode, 'revision_conflict');
    assert.equal(failed.operationId, undefined);
    const next = await publishGatewayRelease(h.state, 'admin', '', '44444444-4444-4444-8444-444444444444', config, fetcher, () => snapshot);
    assert.equal(next.operationId, 'operation-2');
    assert.equal(JSON.parse(h.site.gatewayPublishIntent || '{}').revision, 10);
});

test('wrong CMS site and mismatched Gateway pin are rejected before release upload', async () => {
    const wrong = harness();
    await assert.rejects(() => publishGatewayRelease(wrong.state, 'admin', '', requestKey,
        { ...config, cmsSiteId: '507f1f77bcf86cd799439010' }, wrong.fetcher, () => snapshot), /not bound/i);
    assert.equal(wrong.calls.length, 0);
    const mismatch = harness();
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/template-pin')) return Response.json({ ...record, imageDigest: `sha256:${'d'.repeat(64)}`, templateId: record.id, templateVersion: record.version });
        return mismatch.fetcher(url, init);
    };
    await assert.rejects(() => publishGatewayRelease(mismatch.state, 'admin', '', requestKey, config, fetcher, () => snapshot), /does not match/i);
    assert.equal(mismatch.calls.some((call) => call.url.endsWith('/releases')), false);
});

test('publication requires explicit CMS binding and public URL configuration', () => {
    const parsed = gatewayPublishConfig({ GATEWAY_CMS_WORKSPACE_ID: 'default', GATEWAY_CMS_SITE_ID: cmsSiteId });
    assert.equal(parsed.cmsWorkspaceId, 'default');
    assert.equal(parsed.cmsSiteId, cmsSiteId);
    assert.equal(parsed.siteUrl, '');
});
