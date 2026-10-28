import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gatewayPublishConfig, publishGatewayRelease, readGatewayOperation, type GatewayPublishConfig, type GatewayReleaseSource } from './gateway-publish';
import type { ReleaseRecord, ReleaseSnapshot } from './releases';
import type { SiteInstallation } from './site-model';
import { recoverGatewayPublication } from './gateway-recovery';
import { reconcileGatewayState, snapshotFingerprint } from './gateway-state';

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
    const releases = new Map<string, ReleaseRecord>();
    const state: GatewayReleaseSource = {
        findSite: async () => site,
        loadContent: async () => ({}) as Awaited<ReturnType<GatewayReleaseSource['loadContent']>>,
        findRelease: async (id) => releases.get(id) || null,
        insertRelease: async (value) => { releases.set(value._id, structuredClone(value)); },
        activate: async () => { throw new Error('Gateway publication must not activate local state'); },
        audit: async () => undefined,
        saveSite: async (updated, expected) => {
            if (site.updatedAt !== expected) return false;
            if (options.advanceStoredTimestamp) updated.updatedAt = Math.max(Date.now() + 5, expected + 1);
            Object.assign(site, updated);
            return true;
        },
        projectGatewayRelease: async (_site, id, revision) => {
            if ((site.gatewayActiveRevision || 0) > revision) return false;
            site.gatewayCurrentReleaseId = id;
            site.gatewayActiveRevision = revision;
            site.gatewayPublishedReleaseIds = [...new Set([...(site.gatewayPublishedReleaseIds || []), id])];
            return true;
        },
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        if (String(url).endsWith('/template-pin')) return Response.json({ ...record, templateId: record.id, templateVersion: record.version });
        if (String(url).endsWith('/publication-state')) return Response.json({ revision: 9, active: null });
        if (String(url).endsWith(`/api/v1/sites/${gatewaySiteId}`)) return Response.json({ revision: 9 });
        if (String(url).endsWith('/releases')) return Response.json({ releaseId: JSON.parse(String(init?.body)).releaseId }, { status: 201 });
        if (String(url).endsWith('/publish-operations')) return Response.json({ id: 'operation-1', status: 'pending', revision: 10 }, { status: 202 });
        throw new Error(`Unexpected Gateway URL: ${String(url)}`);
    };
    return { site, state, calls, fetcher, releases };
}

test('Gateway submission retains a CMS-identity immutable snapshot and actor before uploading', async () => {
    const h = harness();
    const result = await publishGatewayRelease(h.state, 'publisher-1', '', requestKey, config, h.fetcher, () => snapshot);
    const saved = h.releases.get(result.releaseId);
    assert.ok(saved, 'persisted Release also invokes the real repository media retention hook');
    assert.equal(saved.createdBy, 'publisher-1');
    assert.equal(saved.siteId, cmsSiteId);
    assert.equal(JSON.parse(saved.payload).workspaceId, 'default');
    assert.equal(JSON.parse(saved.payload).siteId, cmsSiteId);
    assert.equal(h.site.currentReleaseId, '', 'pending Gateway releases never activate local publishing');
});

test('a failed durable media/snapshot write prevents uploading or starting the publication', async () => {
    const h = harness();
    h.state.insertRelease = async () => { throw new Error('Media is being deleted'); };
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot), /being deleted/);
    assert.equal(h.calls.some(call => call.url.endsWith('/releases') || call.url.endsWith('/publish-operations')), false);
});

test('an operation ready response alone cannot grant public access without the active deployment', async () => {
    const h = harness();
    const result = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    await assert.rejects(() => readGatewayOperation(h.state, h.site, result.operationId, config, async (url, init) => {
        if (String(url).includes('/publish-operations/')) return Response.json({ id: result.operationId, releaseId: result.releaseId, status: 'ready', revision: 10 });
        return h.fetcher(url, init);
    }), /active|deployment|confirmed/i);
});

function activeResponse(h: ReturnType<typeof harness>, revision = 10) {
    const intent = JSON.parse(h.site.gatewayPublishIntent || '{}');
    return { revision, active: { releaseId: intent.releaseId, imageDigest: record.imageDigest, routeRevision: revision,
        createdAt: new Date().toISOString(), metadata: { templateId: record.id, templateVersion: record.version,
            imageDigest: record.imageDigest, manifestChecksum: record.manifestChecksum, imageRepository: record.imageRepository,
            sourceCommit: record.sourceCommit }, snapshot: JSON.parse(Buffer.from(intent.snapshot, 'base64').toString()) } };
}

test('confirmed active deployment projects history while preserving local publishing and original actor', async () => {
    const h = harness();
    const result = await publishGatewayRelease(h.state, 'publisher-1', '', requestKey, config, h.fetcher, () => snapshot);
    const active = activeResponse(h);
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/publication-state')) return Response.json(active);
        if (String(url).includes('/publish-operations/')) return Response.json({ id: result.operationId, releaseId: result.releaseId, status: 'ready', revision: 10 });
        return h.fetcher(url, init);
    };
    await readGatewayOperation(h.state, h.site, result.operationId, config, fetcher);
    assert.equal(h.site.gatewayCurrentReleaseId, result.releaseId);
    assert.deepEqual(h.site.gatewayPublishedReleaseIds, [result.releaseId]);
    assert.equal(h.site.currentReleaseId, '');
    assert.equal(h.releases.get(result.releaseId)?.createdBy, 'publisher-1');
    let previous: ReleaseSnapshot | undefined;
    await publishGatewayRelease(h.state, 'publisher-2', result.releaseId, requestKey.replace('3333', '4444'), config, fetcher,
        (input) => { previous = input.previous; return snapshot; });
    assert.deepEqual(previous, { ...snapshot, workspaceId: 'default' });
});

test('reconciliation recovers a legacy publication with CMS identities and refuses stale route revisions', async () => {
    const h = harness();
    await publishGatewayRelease(h.state, 'publisher', '', requestKey, config, h.fetcher, () => snapshot);
    const response = activeResponse(h);
    h.releases.clear();
    await reconcileGatewayState(h.state, h.site, config, async () => Response.json(response));
    assert.equal(JSON.parse(h.releases.get(response.active.releaseId)!.payload).siteId, cmsSiteId);
    h.site.gatewayActiveRevision = 20;
    h.site.gatewayCurrentReleaseId = 'newer-release';
    await assert.rejects(() => reconcileGatewayState(h.state, h.site, config, async () => Response.json(response)), /newer/);
    assert.equal(h.site.gatewayCurrentReleaseId, 'newer-release');
});

test('checked content cannot silently change before Gateway publication', async () => {
    const h = harness();
    const checked = snapshotFingerprint({ ...snapshot, workspaceId: 'default' }, record as never);
    await assert.rejects(() => publishGatewayRelease(h.state, 'publisher', '', requestKey, config, h.fetcher,
        () => ({ ...snapshot, language: 'zh' }), { snapshotHash: checked }), /changed after validation/);
    assert.equal(h.calls.some(call => call.url.endsWith('/releases')), false);
});

test('Gateway restoration uses only a published historical snapshot and ignores edited draft content', async () => {
    const h = harness();
    const first = await publishGatewayRelease(h.state, 'publisher', '', requestKey, config, h.fetcher, () => snapshot);
    const active = activeResponse(h);
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith('/publication-state')
        ? Response.json(active) : h.fetcher(url, init);
    h.site.gatewayPublishIntent = JSON.stringify({ ...JSON.parse(h.site.gatewayPublishIntent!), status: 'ready' });
    await reconcileGatewayState(h.state, h.site, config, fetcher);
    const restored = await publishGatewayRelease(h.state, 'restorer', first.releaseId, requestKey.replace('3333', '4444'),
        config, fetcher, () => { throw new Error('Restoration must not read current drafts'); }, { restoreReleaseId: first.releaseId });
    assert.notEqual(restored.releaseId, first.releaseId);
    assert.equal(h.releases.get(restored.releaseId)?.sourceReleaseId, first.releaseId);
    assert.equal(h.releases.get(restored.releaseId)?.payload, h.releases.get(first.releaseId)?.payload);
});

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

test('a ready intent from an adopted older version can be replaced by the next version publication', async () => {
    const h = harness();
    const first = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    const previousIntent = JSON.parse(h.site.gatewayPublishIntent || '{}');
    h.site.gatewayPublishIntent = JSON.stringify({ ...previousIntent, status: 'ready' });
    const nextRecord = { ...record, version: '1.0.2', manifestPath: 'templates/aeroframe/1.0.2/template.json',
        manifestChecksum: `sha256:${'e'.repeat(64)}`, imageDigest: `sha256:${'f'.repeat(64)}` };
    h.site.presetVersion = '1.0.2';
    h.site.publishedTemplateRecord = JSON.stringify(nextRecord);
    h.site.presetManifestSnapshot = JSON.stringify({ id: 'aeroframe', version: '1.0.2' });
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value.endsWith('/template-pin')) return Response.json({ ...nextRecord, templateId: nextRecord.id, templateVersion: nextRecord.version });
        return h.fetcher(url, init);
    };
    const next = await publishGatewayRelease(h.state, 'admin', '', requestKey.replace('3333', '5555'), config, fetcher, () => snapshot);
    assert.notEqual(next.releaseId, first.releaseId);
    const nextIntent = JSON.parse(h.site.gatewayPublishIntent || '{}');
    assert.equal(nextIntent.record.version, '1.0.2');
    assert.equal(nextIntent.requestKey, requestKey.replace('3333', '5555'));
});

test('Gateway revision conflict becomes terminal and a new explicit action reads a fresh revision', async () => {
    const h = harness();
    let revision = 9;
    let operationAttempt = 0;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value.endsWith('/template-pin')) return Response.json({ ...record, templateId: record.id, templateVersion: record.version });
        if (value.endsWith(`/api/v1/sites/${gatewaySiteId}`)) return Response.json({ revision });
        if (value.endsWith('/publication-state')) return Response.json({ revision, active: null });
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


test('background recovery resumes a lost submit response with the original frozen bytes and actor', async () => {
    const h = harness();
    let lost = true;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/publish-operations') && lost) { lost = false; throw new Error('Connection lost after submit'); }
        return h.fetcher(url, init);
    };
    await assert.rejects(() => publishGatewayRelease(h.state, 'original-actor', '', requestKey, config, fetcher, () => snapshot), /Connection lost/);
    const frozen = JSON.parse(h.site.gatewayPublishIntent!);
    h.state.loadContent = async () => { throw new Error('Recovery must not read edited drafts'); };
    await recoverGatewayPublication(h.state, config, fetcher);
    const recovered = JSON.parse(h.site.gatewayPublishIntent!);
    assert.equal(recovered.snapshot, frozen.snapshot);
    assert.equal(recovered.actorId, 'original-actor');
    assert.equal(recovered.operationId, 'operation-1');
    assert.equal(h.site.gatewayCurrentReleaseId, undefined);
});

test('background recovery records a failed operation without promoting its private candidate', async () => {
    const h = harness();
    const events: unknown[] = [];
    h.state.audit = async event => { events.push(event); };
    const submitted = await publishGatewayRelease(h.state, 'original-actor', '', requestKey, config, h.fetcher, () => snapshot);
    await recoverGatewayPublication(h.state, config, async (url, init) => String(url).includes('/publish-operations/')
        ? Response.json({ id: submitted.operationId, releaseId: submitted.releaseId, status: 'failed', revision: 10, failureCode: 'readiness_failed' })
        : h.fetcher(url, init));
    assert.equal(h.site.gatewayCurrentReleaseId, undefined);
    assert.equal(h.site.gatewayPublishedReleaseIds?.includes(submitted.releaseId) || false, false);
    assert.ok(events.some((event: any) => event.actorId === 'original-actor' && event.error === 'readiness_failed'));
});

test('lost reply can recover when the frozen release has already become active', async () => {
    const h = harness();
    await assert.rejects(() => publishGatewayRelease(h.state, 'original-actor', '', requestKey, config,
        async (url, init) => { if (String(url).endsWith('/publish-operations')) throw new Error('lost'); return h.fetcher(url, init); }, () => snapshot), /lost/);
    const active = activeResponse(h);
    h.state.loadContent = async () => { throw new Error('No new draft'); };
    await recoverGatewayPublication(h.state, config, async (url, init) => {
        if (String(url).endsWith('/publication-state')) return Response.json(active);
        return h.fetcher(url, init);
    });
    assert.equal(h.site.gatewayCurrentReleaseId, active.active.releaseId);
    assert.equal(JSON.parse(h.site.gatewayPublishIntent!).releaseId, active.active.releaseId);
    assert.equal(h.releases.get(active.active.releaseId)?.createdBy, 'original-actor');
});

test('reconciliation compares immutable template values independently of registry key order', async () => {
    const h = harness();
    h.site.publishedTemplateRecord = JSON.stringify(Object.fromEntries(Object.entries(record).reverse()));
    const submitted = await publishGatewayRelease(h.state, 'original-actor', '', requestKey, config, h.fetcher, () => snapshot);
    await reconcileGatewayState(h.state, h.site, config, async () => Response.json(activeResponse(h)));
    assert.equal(h.site.gatewayCurrentReleaseId, submitted.releaseId);
    assert.equal(h.releases.get(submitted.releaseId)?.createdBy, 'original-actor');
});

test('losing the durable publication CAS cannot change the external Gateway template pin', async () => {
    const h = harness();
    h.state.saveSite = async () => false;
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot), /CMS site changed/);
    assert.equal(h.calls.some(call => call.url.endsWith('/template-pin')), false,
        'a concurrent action must reserve its immutable intent before mutating the shared Gateway pin');
});

test('a cached pin cannot suppress confirmation of the Gateway pin when a frozen submission resumes', async () => {
    const h = harness();
    h.site.gatewayPinnedTemplateRecord = JSON.stringify({ ...record, templateId: record.id, templateVersion: record.version });
    let pinConfirmed = false;
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/template-pin')) pinConfirmed = true;
        if (String(url).endsWith('/releases') && !pinConfirmed) return Response.json({ error: 'template_pin_mismatch' }, { status: 409 });
        return h.fetcher(url, init);
    };
    const submitted = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, fetcher, () => snapshot);
    assert.equal(submitted.operationId, 'operation-1');
    assert.equal(pinConfirmed, true);
});

test('an interrupted immutable upload remains reserved for its original request key', async () => {
    const h = harness();
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config,
        async (url, init) => { if (String(url).endsWith('/releases')) throw new Error('Upload connection lost'); return h.fetcher(url, init); }, () => snapshot), /Upload connection lost/);
    const frozen = JSON.parse(h.site.gatewayPublishIntent!);
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey.replace('3333', '5555'),
        config, h.fetcher, () => snapshot), /still pending/);
    assert.equal(JSON.parse(h.site.gatewayPublishIntent!).releaseId, frozen.releaseId);
});

test('an unverified installed template is rejected before any Gateway reconciliation request', async () => {
    const h = harness();
    delete h.site.publishedTemplateRecord;
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot), /no verified public template/);
    assert.equal(h.calls.length, 0);
});

test('a submit ready response stays pending until the authoritative active deployment confirms it', async () => {
    const h = harness();
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/publish-operations')) return Response.json({ id: 'operation-1', status: 'ready' });
        if (String(url).includes('/publish-operations/')) {
            const intent = JSON.parse(h.site.gatewayPublishIntent!);
            return Response.json({ id: 'operation-1', releaseId: intent.releaseId, status: 'ready', revision: 10 });
        }
        return h.fetcher(url, init);
    };
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, fetcher, () => snapshot), /active|deployment|confirmed/i);
    assert.equal(JSON.parse(h.site.gatewayPublishIntent!).status, 'pending');
    const retried = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, fetcher, () => snapshot);
    assert.equal(retried.status, 'pending');
});

test('replaying a legacy ready intent still verifies its active deployment', async () => {
    const h = harness();
    const submitted = await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
    h.site.gatewayPublishIntent = JSON.stringify({ ...JSON.parse(h.site.gatewayPublishIntent!), status: 'ready' });
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => String(url).includes('/publish-operations/')
        ? Response.json({ id: submitted.operationId, releaseId: submitted.releaseId, status: 'ready', revision: 10 })
        : h.fetcher(url, init);
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, fetcher, () => snapshot), /active|deployment|confirmed/i);
});

test('one request key cannot be replayed with another baseline or restoration target', async () => {
    for (const changed of [{ baseline: 'another-baseline', restoreReleaseId: undefined }, { baseline: '', restoreReleaseId: 'another-history-release' }]) {
        const h = harness();
        await publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot);
        const callCount = h.calls.length;
        await assert.rejects(() => publishGatewayRelease(h.state, 'admin', changed.baseline, requestKey, config,
            h.fetcher, () => snapshot, { restoreReleaseId: changed.restoreReleaseId }), /requestKey.*different.*action/i);
        assert.equal(h.calls.length, callCount);
    }
});

test('a deterministic missing-media failure releases the reservation for a corrected explicit action', async () => {
    const h = harness();
    const { MediaRetentionError } = await import('../media/retention');
    h.state.insertRelease = async () => { throw new MediaRetentionError('Media was deleted before it could be retained'); };
    await assert.rejects(() => publishGatewayRelease(h.state, 'admin', '', requestKey, config, h.fetcher, () => snapshot), /Media was deleted/);
    assert.equal(JSON.parse(h.site.gatewayPublishIntent!).status, 'failed');
    assert.equal(h.calls.some(call => call.url.endsWith('/template-pin') || call.url.endsWith('/releases')), false);
    h.state.insertRelease = async value => { h.releases.set(value._id, structuredClone(value)); };
    const corrected = await publishGatewayRelease(h.state, 'admin', '', requestKey.replace('3333', '7777'), config, h.fetcher,
        () => ({ ...snapshot, language: 'zh' }));
    assert.equal(corrected.operationId, 'operation-1');
});
