import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { observeGatewayPublication } from './gateway-observation';
import type { GatewayPublishConfig } from './gateway-client';
import type { ReleaseRecord } from './releases';
import type { SiteInstallation } from './site-model';

const config: GatewayPublishConfig = { gatewayBaseUrl: 'http://127.0.0.1:3001', cmsWorkspaceId: 'default', cmsSiteId: 'cms-site',
    workspaceId: '11111111-1111-4111-8111-111111111111', siteId: '22222222-2222-4222-8222-222222222222', serviceSecret: 'private', siteUrl: 'https://shop.example.com' };
const digest = `sha256:${'a'.repeat(64)}`;
const template = { schemaVersion: 1, id: 'aeroframe', version: '1.0.4', imageDigest: digest, manifestChecksum: digest,
    sourceCommit: 'b'.repeat(40), imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
    manifestPath: 'templates/aeroframe/1.0.4/template.json', status: 'available' };
const marker = 'HOME-PUBLISHED-MARKER';
const sha = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
function harness() {
    const snapshot: any = { schemaVersion: 1, workspaceId: config.workspaceId, siteId: config.siteId, language: 'en', pages: [
        { path: '/', pageKey: 'home', entryId: 'entry', content: { kind: 'preset-page', view: 'home', sections: ['hero'],
            preset: { id: 'aeroframe', version: '1.0.4', demo: { hero: { title: marker } } } } },
        { path: '/other', pageKey: 'other', content: { unrelated: marker } },
    ], navigation: [], redirects: [] };
    const site = { _id: config.cmsSiteId, workspaceId: 'default', status: 'ready', gatewayCurrentReleaseId: 'release-1',
        gatewayActiveRevision: 7, gatewayPublishedReleaseIds: ['release-1'] } as unknown as SiteInstallation;
    const record = { _id: 'release-1', workspaceId: 'default', siteId: site._id, target: 'gateway', templateRecord: JSON.stringify(template) } as ReleaseRecord;
    const intent: any = { releaseId: 'release-1', status: 'ready', operationId: 'op-7', revision: 6, record: template };
    const state = { revision: 7, active: { releaseId: 'release-1', routeRevision: 7, createdAt: new Date(1000).toISOString(), imageDigest: digest,
        metadata: { templateId: template.id, templateVersion: template.version, imageDigest: digest,
            manifestChecksum: digest, imageRepository: template.imageRepository, sourceCommit: template.sourceCommit }, snapshot } };
    function retain() {
        const bytes = JSON.stringify(snapshot);
        record.payload = JSON.stringify({ ...snapshot, workspaceId: 'default', siteId: site._id }); record.artifactPayload = bytes;
        intent.snapshot = Buffer.from(bytes).toString('base64'); intent.checksum = sha(bytes); site.gatewayPublishIntent = JSON.stringify(intent);
    }
    retain();
    const calls: string[] = [], writes: string[] = [];
    const forbidden = async () => { writes.push('write'); throw new Error('Observation cannot write'); };
    const source = { findSite: async () => site, findRelease: async () => record,
        insertRelease: forbidden, saveSite: forbidden, projectGatewayRelease: forbidden, audit: forbidden, activate: forbidden };
    const fetcher: typeof fetch = async (_url, init) => { calls.push(init?.method || 'GET'); return Response.json(state); };
    const observe = () => observeGatewayPublication(source, config, marker, fetcher);
    return { snapshot, site, record, intent, state, retain, calls, writes, source, fetcher, observe };
}
test('observation reads exact active release/revision and retained immutable payload without writing', async () => {
    const h = harness(), before = structuredClone(h.site);
    const result = await h.observe();
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') assert.fail('ready observation required');
    assert.equal(result.releaseId, 'release-1'); assert.equal(result.activeRevision, 7);
    assert.equal(result.publishedHome.containsMarker, true); assert.equal(result.publishedHome.markerChecksum, sha(marker));
    assert.equal(result.snapshotChecksum, h.intent.checksum);
    assert.deepEqual(h.calls, ['GET']); assert.deepEqual(h.writes, []); assert.deepEqual(h.site, before);
});
test('pending no-operation intent blocks before contacting Gateway and never writes', async () => {
    const h = harness(); h.intent.status = 'pending'; delete h.intent.operationId; h.retain(); const before = structuredClone(h.site);
    assert.equal((await h.observe()).status, 'blocked'); assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []); assert.deepEqual(h.site, before);
});
test('wrong authoritative or retained identity/revision/content blocks without repairing state', async () => {
    for (const change of [
        (h: ReturnType<typeof harness>) => { h.site._id = 'other-site'; },
        (h: ReturnType<typeof harness>) => { h.site.gatewayActiveRevision = 8; },
        (h: ReturnType<typeof harness>) => { h.state.active.releaseId = 'wrong'; },
        (h: ReturnType<typeof harness>) => { h.state.active.routeRevision = 6; },
        (h: ReturnType<typeof harness>) => { h.state.active.snapshot.siteId = 'wrong'; },
        (h: ReturnType<typeof harness>) => { h.record.siteId = 'other-site'; },
        (h: ReturnType<typeof harness>) => { h.record.workspaceId = 'other-workspace'; },
        (h: ReturnType<typeof harness>) => { h.record.target = undefined; },
        (h: ReturnType<typeof harness>) => { h.record.artifactPayload = '{}'; },
        (h: ReturnType<typeof harness>) => { h.record.payload = '{}'; },
        (h: ReturnType<typeof harness>) => { h.record.templateRecord = JSON.stringify({ ...template, version: '1.0.5' }); },
        (h: ReturnType<typeof harness>) => { h.intent.checksum = digest; h.site.gatewayPublishIntent = JSON.stringify(h.intent); },
    ]) {
        const h = harness(); change(h); const before = structuredClone(h.site);
        assert.equal((await h.observe()).status, 'blocked'); assert.ok(h.calls.every(method => method === 'GET')); assert.deepEqual(h.writes, []); assert.deepEqual(h.site, before);
    }
});
test('marker compares the rendered home hero title, excluding metadata, other pages, disabled and overridden titles', async () => {
    for (const change of [
        (h: ReturnType<typeof harness>) => { h.snapshot.pages[0].content.preset.demo.hero.title = 'no marker'; h.snapshot.pages[0].content.seo = { title: marker }; },
        (h: ReturnType<typeof harness>) => { h.snapshot.pages[0].layoutDocument = { root: [{ type: 'hero', enabled: false, props: { title: marker } }] }; },
        (h: ReturnType<typeof harness>) => { h.snapshot.pages[0].content.sectionConfigs = [{ type: 'hero', enabled: true, data: { title: 'override without marker' } }]; },
    ]) {
        const h = harness(); change(h); h.retain(); const result = await h.observe();
        assert.equal(result.status, 'ready'); if (result.status !== 'ready') assert.fail('ready observation required');
        assert.equal(result.publishedHome.containsMarker, false);
    }
    const h = harness(); h.snapshot.pages[0].content.preset.demo.hero.title = 'base';
    h.snapshot.pages[0].layoutDocument = { root: [{ type: 'hero', enabled: true, props: { title: marker } }] }; h.retain();
    const result = await h.observe(); assert.equal(result.status, 'ready'); if (result.status !== 'ready') assert.fail('ready observation required'); assert.equal(result.publishedHome.containsMarker, true);
});
test('Gateway unavailability has a fixed failure status without private diagnostics or writes', async () => {
    const h = harness();
    const result = await observeGatewayPublication(h.source, config, marker, async () => { throw new Error('private service diagnostic'); });
    assert.equal(result.status, 'unavailable'); assert.equal(JSON.stringify(result).includes('private'), false); assert.deepEqual(h.writes, []);
});
