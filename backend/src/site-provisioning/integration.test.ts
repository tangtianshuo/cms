import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { seedIdentity } from '../test-fixtures/identity';
import { Repo } from '../repo';
import { Config } from '../config';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { WorkspaceController } from '../workspaces/controller';
import { ReleaseController } from '../presets/release-controller';
import { keyValueStore } from '../key-value-store';
test.after(() => keyValueStore.destroy());
import { runWithWorkspace } from '../workspaces/context';
import { createProvisioningStore, runProvisioningTick, ProvisioningError } from './service';
import type { SiteInstallation } from '../presets/site-model';

test('authenticated creation and durable Mongo recovery fence workers and preserve server state', { skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 30000 }, async context => {
    const app = Fastify();
    const mongoUrl = process.env.STOREFRONT_TEST_MONGO; assert.ok(mongoUrl);
    await app.register(fastifyMongo, { url: mongoUrl, database: `c3_provisioning_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    context.after(async () => { await app.mongo.db?.dropDatabase(); await app.close(); });
    const db = app.mongo.db; assert.ok(db);
    const sites = db.collection<SiteInstallation>(Repo.siteInstallation.collection);
    // Index startup must support multiple legacy installations without creation keys.
    await sites.insertMany(['legacy-a', 'legacy-b'].map(id => ({ _id: id, slot: id, workspaceId: 'default', name: id, createdAt: 1, updatedAt: 1 } as SiteInstallation)));
    const initialize = async () => { for (const repo of [Repo.workspace, Repo.user, Repo.siteInstallation, Repo.siteGatewayBinding, Repo.storefrontRelease, Repo.storefrontReleaseAudit]) await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app, next: (error?: Error) => error ? reject(error) : resolve() } as never)); };
    await initialize();
    for (const id of ['admin', 'editor', 'viewer', 'foreign']) await seedIdentity(id, id === 'admin' ? 'ADMIN' : 'USER');
    await Repo.workspace.add({ _id: 'c3-workspace', name: 'C3', createdAt: 1, updatedAt: 1, members: [{ userId: 'admin', role: 'admin' }] });
    JWTManager.setScopes([{ issuer: Config.jwtIssuer, secret: Config.jwtSecret, alg: 'HS256', expIn: 60000 }]);
    const jwt = (userId: string) => { const token = JWTManager.create({ issuer: Config.jwtIssuer, userId, roles: [userId === 'admin' ? 'ADMIN' : 'USER'] }); assert.ok(!(token instanceof JWTError)); return `Bearer ${JWTEncode.encode(token)}`; };
    app.setErrorHandler((error, _req, reply) => reply.code((error as { status?: number }).status || 500).send({ message: error.message }));
    for (const factory of [WorkspaceController, ReleaseController]) {
        const controller = await factory({} as never);
        for (const method of await controller.methods(controller)) app.route({ method: method.type.toUpperCase() as 'GET', url: `${controller.path}${method.path}`, handler: method.handler });
    }
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    async function request(url: string, body?: unknown, actor = 'admin', workspace = 'c3-workspace', siteId?: string) {
        const response = await fetch(`${address}${url}`, { method: body === undefined ? 'GET' : 'POST',
            headers: { authorization: jwt(actor), 'x-bcms-workspace': workspace, ...(siteId ? { 'x-bcms-site': siteId } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        return { statusCode: response.status, body: text, json<T = Record<string, unknown>>(): T { return JSON.parse(text); } };
    }
    async function authenticatedRequest(url: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}) { const response = await request(url, options.body); assert.equal(response.statusCode, 200, response.body); return response.json<SiteInstallation>(); }
    assert.equal((await request('/api/v4/workspaces/current/sites', { name: 'Missing key' })).statusCode, 400);
    const body = { name: '站点 A', requestKey: 'create-site-test-1' };
    const [a, b] = await Promise.all([authenticatedRequest('/api/v4/workspaces/current/sites', { method: 'POST', body }), authenticatedRequest('/api/v4/workspaces/current/sites', { method: 'POST', body })]);
    assert.equal(a._id, b._id);
    const initialProvisioning = a.provisioning; assert.ok(initialProvisioning);
    assert.equal(initialProvisioning.status, 'pending');
    assert.equal(await sites.countDocuments({ creationRequestKey: body.requestKey }), 1);
    assert.deepEqual((await Repo.workspace.methods.fresh('c3-workspace'))?.pendingCreations, []);
    assert.equal((await request('/api/v4/workspaces/current/sites', { ...body, name: 'different' })).statusCode, 409);
    const index = (await sites.indexes()).find(item => item.name === 'workspace_creation_request_unique');
    assert.deepEqual(index?.partialFilterExpression, { creationRequestKey: { $type: 'string' } });
    const store = createProvisioningStore();
    let now = Date.now();
    const claimed = await store.claim(now); assert.ok(claimed);
    assert.equal(claimed.state.leaseUntil, now + 60000);
    assert.equal(await store.claim(now), null);
    const originalToken = claimed.state.leaseToken; assert.ok(originalToken);
    const next = await store.claim(now + 60001); assert.ok(next);
    const binding = { cmsWorkspaceId: 'c3-workspace', cmsSiteId: a._id, workspaceId: randomUUID(), siteId: randomUUID(), siteUrl: 'https://s.example.test', source: 'provisioned' as const };
    assert.equal(await store.complete(a._id, originalToken, { ...binding, siteId: randomUUID() }), false);
    assert.equal(await db.collection(Repo.siteGatewayBinding.collection).countDocuments({}), 0);
    assert.equal((await sites.findOne({ _id: a._id }))?.provisioning?.leaseToken, next.state.leaseToken);
    assert.equal(await store.defer(a._id, originalToken, now, 'gateway_unavailable'), false);
    // Gateway success persisted the mapping, then CMS died before completing its intent.
    await runWithWorkspace({ workspaceId: 'c3-workspace', siteId: a._id, actorId: '__test', admin: true, instanceAdmin: true, role: 'admin' }, () => Repo.siteGatewayBinding.methods.persist(binding));
    await initialize(); // Recreate repositories as a CMS process restart would.
    now += 120002;
    let gatewayCalls = 0;
    const inputs: string[] = [];
    const provision = async (input: { requestKey: string }) => { gatewayCalls++; inputs.push(input.requestKey); return binding; };
    await Promise.all([runProvisioningTick(createProvisioningStore(), provision, now), runProvisioningTick(createProvisioningStore(), provision, now)]);
    assert.equal(gatewayCalls, 1);
    assert.deepEqual(inputs, [body.requestKey]);
    const ready = await sites.findOne({ _id: a._id }); assert.equal(ready?.provisioning?.status, 'ready');
    // Both stale content and template imports must preserve keys and ready status.
    await runWithWorkspace({ workspaceId: 'c3-workspace', siteId: a._id, actorId: 'admin', admin: true, instanceAdmin: true, role: 'admin' }, async () => {
        const stale = { ...a, name: 'Renamed', creationRequestKey: 'forged', provisioning: { ...initialProvisioning, requestKey: 'forged' } };
        await Repo.siteInstallation.methods.updateImport(stale);
        assert.equal(await Repo.siteInstallation.methods.saveDraft(stale, stale.updatedAt), true);
    });
    const retained = await sites.findOne({ _id: a._id });
    assert.equal(retained?.provisioning?.status, 'ready'); assert.equal(retained?.provisioning?.requestKey, body.requestKey); assert.equal(retained?.creationRequestKey, body.requestKey);
    assert.equal((await authenticatedRequest('/api/v4/workspaces/current/sites', { body: { ...body, name: ` ${body.name} ` } }))._id, a._id);
    assert.equal(await store.complete(a._id, originalToken, { ...binding, siteId: randomUUID() }), false);
    assert.deepEqual((await Repo.workspace.methods.fresh('c3-workspace'))?.pendingCreations, []);
    const statusUrl = `/api/v4/workspaces/current/sites/${a._id}/provisioning`;
    const status = await request(statusUrl); assert.equal(status.statusCode, 200); assert.equal(status.json().status, 'ready'); assert.equal(status.body.includes('leaseToken'), false);
    assert.equal((await request(`${statusUrl}/retry`, {})).statusCode, 409);
    const workspace = await Repo.workspace.methods.fresh('c3-workspace'); assert.ok(workspace);
    await Repo.workspace.methods.member('c3-workspace', 'editor', 'editor'); await Repo.workspace.methods.member('c3-workspace', 'viewer', 'viewer');
    assert.equal((await request(`${statusUrl}/retry`, {}, 'editor')).statusCode, 403);
    assert.equal((await request(statusUrl, undefined, 'viewer')).statusCode, 200);
    assert.equal((await request(statusUrl, undefined, 'foreign')).statusCode, 403);
    const foreignSite = await sites.insertOne({ ...a, _id: 'foreign-site', slot: 'foreign-site', workspaceId: 'other', creationRequestKey: 'other', provisioning: undefined }); assert.ok(foreignSite);
    assert.equal((await request('/api/v4/workspaces/current/sites/foreign-site/provisioning')).statusCode, 404);
    assert.equal((await request('/api/v4/workspaces/current/sites/foreign-site/provisioning/retry', {})).statusCode, 404);
    const c = await authenticatedRequest('/api/v4/workspaces/current/sites', { body: { name: 'Failure', requestKey: 'failure-key' } });
    await runProvisioningTick(store, async () => { throw new ProvisioningError('gateway_unauthorized'); }, now);
    assert.equal((await sites.findOne({ _id: c._id }))?.provisioning?.status, 'failed');
    await authenticatedRequest(`/api/v4/workspaces/current/sites/${c._id}/provisioning/retry`, { body: {} });
    const retry = await sites.findOne({ _id: c._id }); assert.equal(retry?.provisioning?.requestKey, 'failure-key'); assert.equal(retry?.provisioning?.attempts, 0);
    for (let attempt = 1; attempt <= 8; attempt++) {
        now += 300001;
        await runProvisioningTick(store, async () => { throw new Error('private internal address'); }, now);
        const failed = await sites.findOne({ _id: c._id });
        assert.equal(failed?.provisioning?.attempts, attempt); assert.equal(failed?.provisioning?.status, attempt === 8 ? 'failed' : 'pending'); assert.equal(failed?.provisioning?.lastError, 'gateway_unavailable');
    }
    assert.equal(await store.claim(now + 999999), null); // Legacy rows never auto-provision.
    // An expired final worker must become retryable even when another due site is claimed.
    const busy = await authenticatedRequest('/api/v4/workspaces/current/sites', { body: { name: 'Busy queue work', requestKey: 'busy-queue-original-key' } });
    await sites.updateOne({ _id: c._id }, { $set: { 'provisioning.status': 'running', 'provisioning.attempts': 8, 'provisioning.leaseToken': 'dead-worker', 'provisioning.leaseUntil': now - 1 } });
    const busyInputs: string[] = [];
    await runProvisioningTick(store, async input => {
        busyInputs.push(input.requestKey);
        assert.equal(input.cmsSiteId, busy._id);
        return { ...binding, cmsSiteId: busy._id, siteId: randomUUID() };
    }, now);
    assert.deepEqual(busyInputs, ['busy-queue-original-key']);
    assert.equal((await sites.findOne({ _id: busy._id }))?.provisioning?.status, 'ready');
    assert.equal((await sites.findOne({ _id: c._id }))?.provisioning?.status, 'failed');
    const exhaustedStatus = await request(`/api/v4/workspaces/current/sites/${c._id}/provisioning`);
    assert.equal(exhaustedStatus.json().status, 'failed');
    await authenticatedRequest(`/api/v4/workspaces/current/sites/${c._id}/provisioning/retry`, { body: {} });
    const restarted = (await sites.findOne({ _id: c._id }))?.provisioning;
    assert.equal(restarted?.status, 'pending'); assert.equal(restarted?.attempts, 0); assert.equal(restarted?.requestKey, 'failure-key');
    assert.equal(await store.complete(c._id, 'dead-worker', { ...binding, cmsSiteId: c._id, siteId: randomUUID() }), false);
    assert.equal(await store.defer(c._id, 'dead-worker', now, 'gateway_unavailable'), false);
    assert.equal((await sites.findOne({ _id: c._id }))?.provisioning?.status, 'pending');
    await runWithWorkspace({ workspaceId: 'c3-workspace', siteId: a._id, actorId: '__test', admin: true, instanceAdmin: true, role: 'admin' }, async () => { assert.equal((await Repo.siteGatewayBinding.methods.find('c3-workspace', a._id))?.siteId, binding.siteId); });
    const parameterRace = await Promise.all(['First name', 'Second name'].map(name => request('/api/v4/workspaces/current/sites', { name, requestKey: 'different-parameters-race' })));
    assert.deepEqual(parameterRace.map(item => item.statusCode).sort(), [200, 409]);
    assert.equal(await sites.countDocuments({ creationRequestKey: 'different-parameters-race' }), 1);
    assert.deepEqual((await Repo.workspace.methods.fresh('c3-workspace'))?.pendingCreations, []);
    // Direct release APIs (also used by Studio) must enforce readiness independently of onboarding.
    const releaseRequest = (path: string, payload?: unknown) => request(`/api/v4/presets/releases/${path}`, payload, 'admin', 'c3-workspace', a._id);
    const publicationsBefore = await db.collection(Repo.storefrontRelease.collection).countDocuments({});
    for (const preparation of ['pending', 'running', 'failed', 'ready'] as const) {
        await sites.updateOne({ _id: a._id }, { $set: { 'provisioning.status': preparation } });
        const published = await releaseRequest('publish', { expectedReleaseId: '' });
        assert.equal(published.statusCode, 409, `${preparation}: ${published.body}`);
        assert.equal(published.body.includes('private'), false);
        assert.equal((await releaseRequest('rollback', { releaseId: 'older', expectedReleaseId: '' })).statusCode, 409);
        const check = await releaseRequest('check', {});
        assert.equal(check.statusCode, 409);
        const info = await releaseRequest('gateway');
        assert.equal(info.statusCode, 200, info.body);
        assert.deepEqual(info.json().preparation, { status: preparation, allowed: false });
        assert.equal(info.json().bound, false);
    }
    // A ready marker plus legacy environment mapping cannot replace the actual durable binding.
    const envKeys = ['GATEWAY_BASE_URL', 'CMS_SERVICE_SECRET', 'GATEWAY_SITE_BINDINGS'];
    const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    try {
        process.env.GATEWAY_BASE_URL = 'http://127.0.0.1:1'; process.env.CMS_SERVICE_SECRET = 'private-test-secret';
        process.env.GATEWAY_SITE_BINDINGS = JSON.stringify([{ cmsWorkspaceId: binding.cmsWorkspaceId, cmsSiteId: binding.cmsSiteId, workspaceId: binding.workspaceId, siteId: binding.siteId, siteUrl: binding.siteUrl }]);
        await db.collection(Repo.siteGatewayBinding.collection).deleteMany({ cmsSiteId: a._id });
        assert.equal((await releaseRequest('publish', { target: 'gateway', requestKey: 'gate-test', expectedReleaseId: '' })).statusCode, 409);
        assert.equal((await releaseRequest('rollback', { requestKey: 'gate-test', releaseId: 'older', expectedReleaseId: '' })).statusCode, 409);
        assert.deepEqual((await releaseRequest('gateway')).json().preparation, { status: 'ready', allowed: false });
        // A real persisted-only mapping selects its exact target and source headers over HTTP.
        delete process.env.GATEWAY_SITE_BINDINGS;
        await runWithWorkspace({ workspaceId: 'c3-workspace', siteId: a._id, actorId: '__test', admin: true, instanceAdmin: true, role: 'admin' }, () => Repo.siteGatewayBinding.methods.persist(binding));
        const gateway = Fastify(); let remoteReads = 0;
        gateway.get(`/api/v1/sites/${binding.siteId}/publication-state`, async req => {
            remoteReads++;
            assert.equal(req.headers['x-cms-workspace'], binding.cmsWorkspaceId);
            assert.equal(req.headers['x-cms-site'], a._id);
            return { revision: 0, active: null };
        });
        try {
            process.env.GATEWAY_BASE_URL = await gateway.listen({ host: '127.0.0.1', port: 0 });
            const info = await releaseRequest('gateway');
            assert.equal(info.statusCode, 200, info.body);
            assert.deepEqual(info.json().preparation, { status: 'ready', allowed: true });
            assert.equal(info.json().bound, true);
            assert.equal(info.json().publishStatus, null); // Preparation is not publication.
            assert.equal(remoteReads, 1);
            assert.equal((await releaseRequest('publish', { expectedReleaseId: '' })).statusCode, 409);
            const rollback = await releaseRequest('rollback', { requestKey: randomUUID(), releaseId: 'older', expectedReleaseId: '' });
            assert.equal(rollback.statusCode, 400); // Remote authority checked, then unpublished restore target rejected.
            assert.equal(remoteReads, 1); // Empty installation is still not publishable.
            await sites.updateOne({ _id: a._id }, { $set: { status: 'ready' } });
            const readyRollback = await releaseRequest('rollback', { requestKey: randomUUID(), releaseId: 'older', expectedReleaseId: '' });
            assert.equal(readyRollback.statusCode, 400);
            assert.equal(remoteReads, 2);
            assert.equal(readyRollback.body.includes('never published'), true);
        } finally { await gateway.close(); }
    } finally {
        for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    assert.equal(await db.collection(Repo.storefrontRelease.collection).countDocuments({}), publicationsBefore);

});
