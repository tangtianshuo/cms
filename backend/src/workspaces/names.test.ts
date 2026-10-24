import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { runWithWorkspace, type WorkspaceContext } from './context';
const scope = (id: string): WorkspaceContext => ({ workspaceId: id, actorId: 'admin', admin: true, instanceAdmin: true, role: 'admin' });
test('Entry names conflict across templates atomically and foreign references are rejected', { skip: !process.env.STOREFRONT_TEST_MONGO }, async t => {
 const app = Fastify();
 await app.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database: `cms_names_${randomUUID().replaceAll('-', '')}`, forceClose: true });
 t.after(async () => { await app.mongo.db!.dropDatabase(); await app.close(); });
 for (const repo of [Repo.workspace, Repo.template, Repo.group, Repo.widget, Repo.media, Repo.entryGroup, Repo.entry, Repo.language, Repo.entryStatus, Repo.siteInstallation]) await new Promise<void>((resolve,reject) => repo.init().initialize({ fastify: app, next: (e?: Error) => e ? reject(e) : resolve() } as never));
 for (const id of ['a','b']) await Repo.workspace.add({ _id: id, name: id, members: [] } as never);
 const entry = (id: string, templateId: string, title: string, groupId?: string) => ({ _id: id, templateId, groupId, userId:'admin', meta:[{lng:'en',props:[{id:'title',data:[title]}]}], statuses:[], content:[] } as never);
 for (const id of ['a','b']) await runWithWorkspace(scope(id), async () => {
  for (const model of ['one','two']) await Repo.template.add({ _id: `${id}-${model}`, name:model, props:[{id:'title',name:'title',type:'STRING'}] } as never);
 });
 await runWithWorkspace(scope('a'), async () => {
  await Repo.entry.add(entry('first','a-one',' ＨＥＬＬＯ '));
  await assert.rejects(Repo.entry.add(entry('duplicate','a-two','hello')));
  const results = await Promise.allSettled([Repo.entry.add(entry('race1','a-one','race')), Repo.entry.add(entry('race2','a-two','RACE'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(Repo.entry.add(entry('foreign','b-one','other')));
 });
 await runWithWorkspace(scope('b'), () => Repo.entry.add(entry('allowed','b-one','hello')));
});
