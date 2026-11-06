import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { keyValueStore } from '../key-value-store';
import { runWithWorkspace } from '../workspaces/context';
import { resolveGatewayPublishConfig, resolveGatewayPublishConfigs } from './config';
import { readGatewayDomainState } from '../site-domains/gateway';
import { gatewayLeadsConfigured, listGatewayLeads, updateGatewayLead } from '../leads/gateway';
import { listGatewayAnalytics } from '../analytics/gateway';
import { runGatewayRecoveryTick } from '../presets/gateway-jobs';
import type { SiteGatewayBinding } from './model';
test.after(() => keyValueStore.destroy());

test('persisted-only selected sites send authoritative source headers through CMS clients over HTTP', { skip: !process.env.STOREFRONT_TEST_MONGO }, async context => {
    const app = Fastify(), gateway = Fastify();
    const mongoUrl = process.env.STOREFRONT_TEST_MONGO; assert.ok(mongoUrl);
    await app.register(fastifyMongo, { url: mongoUrl, database: `c2_transport_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    const db = app.mongo.db; assert.ok(db);
    context.after(async () => { await db.dropDatabase(); await app.close(); await gateway.close(); });
    await new Promise<void>((resolve, reject) => Repo.siteGatewayBinding.init().initialize({ fastify: app,
        next: (error?: Error) => error ? reject(error) : resolve() } as never));
    const bindings: SiteGatewayBinding[] = ['a', 'b'].map(suffix => ({ cmsWorkspaceId: `workspace-${suffix}`, cmsSiteId: `site-${suffix}`,
        workspaceId: randomUUID(), siteId: randomUUID(), siteUrl: `https://s-${suffix}.sites.example`, source: 'provisioned' }));
    const scoped = <T>(binding: SiteGatewayBinding, action: () => T) => runWithWorkspace({ workspaceId: binding.cmsWorkspaceId,
        siteId: binding.cmsSiteId, actorId: 'verified-admin', admin: true, instanceAdmin: true, role: 'admin' }, action);
    for (const binding of bindings) await scoped(binding, () => Repo.siteGatewayBinding.methods.persist(binding));
    const calls: string[] = [];
    gateway.all('/api/v1/sites/:siteId/*', async request => {
        const binding = bindings.find(item => item.siteId === (request.params as { siteId: string }).siteId);
        assert.ok(binding);
        assert.equal(request.headers.authorization, 'Bearer test-transport-secret');
        assert.equal(request.headers['x-cms-workspace'], binding.cmsWorkspaceId);
        assert.equal(request.headers['x-cms-site'], binding.cmsSiteId);
        calls.push(`${binding.cmsSiteId}:${request.method}:${request.url.split('?')[0].split('/').at(-1)}`);
        if (request.url.includes('/domains')) return { route: { status: 'pending', revision: 0, releaseId: null, host: null, health: 'unknown' }, domains: [] };
        if (request.url.includes('/events')) return { totals: { visits: 1 }, pages: [] };
        const item = { id: `lead-${binding.cmsSiteId}`, siteId: binding.siteId, source: 'contact', schemaVersion: 1, fields: {},
            status: request.method === 'PATCH' ? 'contacted' : 'new', notificationStatus: 'pending', createdAt: new Date(1000).toISOString(), updatedAt: new Date(1000).toISOString() };
        return request.method === 'PATCH' ? { item } : { items: [item] };
    });
    const address = await gateway.listen({ host: '127.0.0.1', port: 0 });
    const keys = ['GATEWAY_BASE_URL', 'CMS_SERVICE_SECRET', 'GATEWAY_SITE_BINDINGS', 'GATEWAY_CMS_WORKSPACE_ID', 'GATEWAY_CMS_SITE_ID', 'GATEWAY_WORKSPACE_ID', 'GATEWAY_SITE_ID', 'GATEWAY_PUBLIC_SITE_URL'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    process.env.GATEWAY_BASE_URL = address; process.env.CMS_SERVICE_SECRET = 'test-transport-secret';
    context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    for (const binding of bindings) await scoped(binding, async () => {
        assert.equal((await resolveGatewayPublishConfig()).siteId, binding.siteId);
        assert.equal((await readGatewayDomainState(binding.cmsSiteId)).status, 'ready');
        assert.equal(await gatewayLeadsConfigured(binding.cmsSiteId), true);
        const leads = await listGatewayLeads(binding.cmsSiteId);
        assert.ok(leads?.[0]); assert.equal(leads[0].siteId, binding.cmsSiteId);
        assert.equal((await updateGatewayLead(binding.cmsSiteId, leads[0]._id, { status: 'contacted' }))?.status, 'contacted');
        assert.ok(await listGatewayAnalytics(binding.cmsSiteId, 7));
        const other = bindings.find(item => item !== binding); assert.ok(other);
        assert.equal(await listGatewayLeads(other.cmsSiteId), null);
        assert.equal(await listGatewayAnalytics(other.cmsSiteId, 7), null);
        assert.deepEqual(await readGatewayDomainState(other.cmsSiteId), { status: 'unconfigured' });
    });
    assert.equal(calls.length, 8);
    const visited: string[] = [];
    await runGatewayRecoveryTick(resolveGatewayPublishConfigs, async config => {
        const selected = await resolveGatewayPublishConfig();
        assert.equal(selected.cmsWorkspaceId, config.cmsWorkspaceId); assert.equal(selected.cmsSiteId, config.cmsSiteId);
        visited.push(selected.cmsSiteId);
    });
    assert.deepEqual(visited.sort(), ['site-a', 'site-b']);
});
