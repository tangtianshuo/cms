import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayConfigResolver, createGatewayConfigsLoader } from './config';
import type { BindingReader, SiteGatewayBinding } from './model';

const binding: SiteGatewayBinding = { cmsWorkspaceId: 'w1', cmsSiteId: 's1',
    workspaceId: '11111111-1111-4111-8111-111111111111', siteId: '22222222-2222-4222-8222-222222222222',
    siteUrl: 'https://s1.sites.example', source: 'provisioned' };
const env = { GATEWAY_BASE_URL: 'https://gateway.example', CMS_SERVICE_SECRET: 'test-only' };
const legacyEnv = (value = binding) => { const { source: _, ...legacy } = value; return { ...env, GATEWAY_SITE_BINDINGS: JSON.stringify([legacy]) }; };
const reader: BindingReader = { find: async (workspace, site) => workspace === 'w1' && site === 's1' ? binding : null,
    listProvisioned: async () => [binding] };

test('resolves the exact persisted identity with server source headers in dynamic-only mode', async () => {
    const resolve = createGatewayConfigResolver(reader, () => ({ workspaceId: 'w1', siteId: 's1' }));
    const selected = await resolve(env);
    assert.equal(selected.cmsSiteId, 's1'); assert.equal(selected.siteId, binding.siteId);
    assert.deepEqual(selected.sourceHeaders, { 'X-CMS-Workspace': 'w1', 'X-CMS-Site': 's1' });
    assert.equal(selected.serviceSecret, 'test-only');
});

test('does not infer a persisted or explicit environment site without selected verified context', async () => {
    const forbidden: BindingReader = { find: async () => { throw new Error('must not look up a site'); }, listProvisioned: reader.listProvisioned };
    for (const context of [undefined, { workspaceId: 'w1' }]) {
        const resolve = createGatewayConfigResolver(forbidden, () => context);
        for (const environment of [env, legacyEnv()]) {
            const selected = await resolve(environment);
            assert.equal(selected.siteId, ''); assert.equal(selected.siteUrl, ''); assert.equal(selected.sourceHeaders, undefined);
        }
    }
});

test('unknown or foreign selected identity cannot inherit another binding', async () => {
    for (const context of [{ workspaceId: 'w2', siteId: 's1' }, { workspaceId: 'w1', siteId: 's2' }]) {
        const selected = await createGatewayConfigResolver(reader, () => context)(legacyEnv());
        assert.equal(selected.siteId, ''); assert.equal(selected.siteUrl, '');
    }
    const wrongReader = { ...reader, find: async () => binding };
    await assert.rejects(createGatewayConfigResolver(wrongReader, () => ({ workspaceId: 'w2', siteId: 's2' }))(env), /identity|binding/i);
});

test('database failure never falls back to a matching or foreign environment site', async () => {
    const broken: BindingReader = { ...reader, find: async () => { throw new Error('binding database unavailable'); } };
    await assert.rejects(createGatewayConfigResolver(broken, () => ({ workspaceId: 'w1', siteId: 's1' }))(legacyEnv()), /database unavailable/);
});

test('matching environment bindings deduplicate and conflicting identities or URLs fail closed', async () => {
    const resolve = createGatewayConfigResolver(reader, () => ({ workspaceId: 'w1', siteId: 's1' }));
    assert.deepEqual((await resolve(legacyEnv())).sourceHeaders, { 'X-CMS-Workspace': 'w1', 'X-CMS-Site': 's1' });
    for (const change of [{ siteId: '33333333-3333-4333-8333-333333333333' }, { workspaceId: '33333333-3333-4333-8333-333333333333' }, { siteUrl: 'https://other.example' }]) {
        await assert.rejects(resolve(legacyEnv({ ...binding, ...change })), /conflict/i);
    }
});

test('explicit legacy binding remains source-header free and preserves deferred single-site compatibility', async () => {
    const empty: BindingReader = { find: async () => null, listProvisioned: async () => [] };
    const { source: _, ...value } = binding;
    const environment = { ...env, GATEWAY_CMS_WORKSPACE_ID: value.cmsWorkspaceId, GATEWAY_CMS_SITE_ID: value.cmsSiteId,
        GATEWAY_WORKSPACE_ID: value.workspaceId, GATEWAY_SITE_ID: value.siteId, GATEWAY_PUBLIC_SITE_URL: value.siteUrl };
    for (const context of [undefined, { workspaceId: 'w1' }, { workspaceId: 'w1', siteId: 's1' }]) {
        const selected = await createGatewayConfigResolver(empty, () => context)(environment);
        assert.equal(selected.siteId, binding.siteId); assert.equal(selected.sourceHeaders, undefined);
    }
    const legacy = await createGatewayConfigResolver({ ...empty, find: async () => ({ ...binding, source: 'legacy' }) }, () => ({ workspaceId: 'w1', siteId: 's1' }))(env);
    assert.equal(legacy.sourceHeaders, undefined);
});

test('background enumeration awaits persistence, combines legacy sites and deduplicates exact CMS identities', async () => {
    const other = { ...binding, cmsSiteId: 's2', siteId: '33333333-3333-4333-8333-333333333333' };
    const load = createGatewayConfigsLoader({ ...reader, listProvisioned: async () => { await Promise.resolve(); return [binding]; } });
    const { source: _, ...legacy } = other;
    const configs = await load({ ...env, GATEWAY_SITE_BINDINGS: JSON.stringify([legacy]) });
    assert.deepEqual(configs.map(item => item.cmsSiteId), ['s2', 's1']);
    assert.equal(configs[0].sourceHeaders, undefined); assert.equal(configs[1].sourceHeaders?.['X-CMS-Site'], 's1');
    assert.equal((await load(legacyEnv())).length, 1);
    await assert.rejects(load(legacyEnv({ ...binding, siteUrl: 'https://conflict.example' })), /conflict/i);
    await assert.rejects(createGatewayConfigsLoader({ ...reader, listProvisioned: async () => { throw new Error('database unavailable'); } })(env), /database unavailable/);
});

test('background enumeration rejects target reuse by a distinct CMS identity', async () => {
    const other = { ...binding, cmsSiteId: 's2' };
    await assert.rejects(createGatewayConfigsLoader(reader)(legacyEnv(other)), /conflict/i);
});
