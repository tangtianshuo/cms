import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { runWithWorkspace, type WorkspaceContext } from './context';
const scope = (id: string): WorkspaceContext => ({ workspaceId: id, actorId: 'admin', admin: true, instanceAdmin: true, role: 'admin' });
test('generic, custom and warm-cache content reads and writes stay in their workspace', { skip: !process.env.STOREFRONT_TEST_MONGO }, async t => {
    const app = Fastify();
    await app.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database: `cms_content_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    t.after(async () => { await app.mongo.db!.dropDatabase(); await app.close(); });
    for (const repo of [Repo.workspace, Repo.media, Repo.template, Repo.entryGroup, Repo.entry, Repo.group]) await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    for (const id of ['a', 'b']) await Repo.workspace.add({ _id: id, name: id, members: [], createdAt: 1, updatedAt: 1 } as never);
    await app.mongo.db!.collection(Repo.media.collection).insertOne({ _id: 'legacy' as never, name: 'legacy' });
    for (const id of ['a', 'b']) await runWithWorkspace(scope(id), () => Repo.media.add({ _id: `${id}-media`, name: 'shared', isInRoot: true, parentId: '', createdAt: 1, updatedAt: 1 } as never));
    await runWithWorkspace(scope('a'), async () => {
        assert.equal(await Repo.media.findById('b-media'), null);
        assert.deepEqual((await Repo.media.findAll()).map(x => x._id), ['a-media']);
        assert.equal((await Repo.media.methods.findInRootByName('shared'))?._id, 'a-media');
        assert.equal(await Repo.media.count(), 1);
        await assert.rejects(Repo.media.add({ _id: 'forged', workspaceId: 'b' } as never));
        await assert.rejects(Repo.media.update({ _id: 'b-media', workspaceId: 'a' } as never));
        assert.equal(await Repo.media.deleteById('b-media'), false);
        await Repo.media.methods.deleteManyById(['b-media']);
        assert.equal(await Repo.media.findById('legacy'), null);
    });
    await runWithWorkspace(scope('b'), async () => {
        assert.equal((await Repo.media.methods.findInRootByName('shared'))?._id, 'b-media');
        assert.ok(await Repo.media.findById('b-media'));
        assert.deepEqual(Repo.media.cache.items.map(x => x._id), ['b-media']);
    });
    assert.deepEqual((await Repo.media.findAll()).map(x => x._id), ['legacy']);
});
