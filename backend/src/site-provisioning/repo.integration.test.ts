import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { keyValueStore } from '../key-value-store';
const SiteGatewayBindingRepo = Repo.siteGatewayBinding;
test.after(() => keyValueStore.destroy());
import type { SiteGatewayBinding } from './model';
import { runWithWorkspace } from '../workspaces/context';
import type { MongoDBEntry } from '../_server/modules/mongodb/entry';

const scoped = <T>(binding: SiteGatewayBinding, action: () => T) => runWithWorkspace({ workspaceId: binding.cmsWorkspaceId,
    siteId: binding.cmsSiteId, actorId: '__site-provisioning', admin: true, instanceAdmin: true, role: 'admin' }, action);

test('Mongo bindings persist immutably, converge under races, and enforce both compound unique indexes', { skip: !process.env.STOREFRONT_TEST_MONGO }, async context => {
    const app = Fastify();
    const database = `c2_bindings_${randomUUID().replaceAll('-', '')}`;
    const mongoUrl = process.env.STOREFRONT_TEST_MONGO; assert.ok(mongoUrl);
    await app.register(fastifyMongo, { url: mongoUrl, database, forceClose: true });
    const db = app.mongo.db; assert.ok(db);
    context.after(async () => { await db.dropDatabase(); await app.close(); });
    const initialize = () => new Promise<void>((resolve, reject) => SiteGatewayBindingRepo.init().initialize({ fastify: app,
        next: (error?: Error) => error ? reject(error) : resolve() } as never));
    await initialize();
    const binding: SiteGatewayBinding = { cmsWorkspaceId: 'workspace-a', cmsSiteId: 'site-a', workspaceId: randomUUID(), siteId: randomUUID(),
        siteUrl: 'https://s-a.sites.example', source: 'provisioned' };
    const values = await scoped(binding, () => Promise.all(Array.from({ length: 8 }, () => SiteGatewayBindingRepo.methods.persist(binding))));
    for (const value of values) assert.deepEqual(value, binding);
    const collection = db.collection<SiteGatewayBinding & MongoDBEntry>(SiteGatewayBindingRepo.collection);
    assert.equal(await collection.countDocuments(), 1);
    await initialize(); // Discard repository state; the durable row remains the source of identity.
    assert.deepEqual(await scoped(binding, () => SiteGatewayBindingRepo.methods.find(binding.cmsWorkspaceId, binding.cmsSiteId)), binding);
    const indexes = await collection.listIndexes().toArray();
    for (const key of [{ cmsWorkspaceId: 1, cmsSiteId: 1 }, { workspaceId: 1, siteId: 1 }]) {
        assert.ok(indexes.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify(key)));
    }
    const before = await collection.find().toArray();
    for (const change of [{ siteId: randomUUID() }, { workspaceId: randomUUID() }, { siteUrl: 'https://other.example' }, { source: 'legacy' as const }]) {
        await assert.rejects(scoped(binding, () => SiteGatewayBindingRepo.methods.persist({ ...binding, ...change })), /conflict/i);
    }
    const other = { ...binding, cmsWorkspaceId: 'workspace-b', cmsSiteId: 'site-b' };
    await assert.rejects(scoped(other, () => SiteGatewayBindingRepo.methods.persist(other)), /conflict/i);
    await assert.rejects(SiteGatewayBindingRepo.methods.find(binding.cmsWorkspaceId, binding.cmsSiteId), /context|access/i);
    await assert.rejects(scoped(other, () => SiteGatewayBindingRepo.methods.find(binding.cmsWorkspaceId, binding.cmsSiteId)), /context|access/i);
    await assert.rejects(SiteGatewayBindingRepo.methods.persist(binding), /context|access/i);
    assert.deepEqual(await collection.find().toArray(), before);
    const row = before[0];
    await assert.rejects(collection.insertOne({ ...row, _id: randomUUID(), siteId: randomUUID() }), error => (error as { code?: number }).code === 11000);
    await assert.rejects(collection.insertOne({ ...row, _id: randomUUID(), cmsSiteId: 'other' }), error => (error as { code?: number }).code === 11000);
    const legacy = { ...binding, cmsSiteId: 'legacy', siteId: randomUUID(), source: 'legacy' as const };
    await scoped(legacy, () => SiteGatewayBindingRepo.methods.persist({ ...legacy, serviceSecret: 'must-never-persist' } as SiteGatewayBinding));
    assert.deepEqual(await SiteGatewayBindingRepo.methods.listProvisioned(), [binding]);
    assert.equal(JSON.stringify(await collection.find().toArray()).includes('must-never-persist'), false);
});
