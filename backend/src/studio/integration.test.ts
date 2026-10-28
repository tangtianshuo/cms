import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { seedIdentity } from '../test-fixtures/identity';
import { Config } from '../config';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { WorkspaceController } from '../workspaces/controller';
import { PresetController } from '../presets/controller';
import { StudioController } from './controller';
import { resolveWorkspaceContext, runWithWorkspace } from '../workspaces/context';
import { PropFactory } from '../prop/factory';
import { MediaType } from '../media/models/main';
import { MediaFactory } from '../media/factory';
import { PropType } from '../prop/models/main';
import type { SiteInstallation } from '../presets/site-model';
import type { StudioValue } from './business';

test('Studio real HTTP and Mongo authorization, preserving edits, conflicts and idempotent page creation', {
    skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 60000,
}, async t => {
    const app = Fastify();
    await app.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database: `cms_studio_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    t.after(async () => { await app.mongo.db!.dropDatabase(); await app.close(); });
    for (const repo of [Repo.workspace, Repo.user, Repo.apiKey, Repo.widget, Repo.group, Repo.entryStatus, Repo.templateOrganizer,
        Repo.siteInstallation, Repo.template, Repo.entryGroup, Repo.entry, Repo.language, Repo.media, Repo.resourceShare]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    for (const id of ['studio-admin', 'studio-editor', 'studio-viewer', 'studio-no-grant', 'studio-outsider']) await seedIdentity(id, id === 'studio-admin' ? 'ADMIN' : 'USER');
    JWTManager.setScopes([{ issuer: Config.jwtIssuer, secret: Config.jwtSecret, alg: 'HS256', expIn: 600000 }]);
    const bearer = (id: string) => { const jwt = JWTManager.create({ issuer: Config.jwtIssuer, userId: id, roles: id === 'studio-admin' ? ['ADMIN', 'USER'] : ['USER'] }); assert.ok(!(jwt instanceof JWTError)); return `Bearer ${JWTEncode.encode(jwt)}`; };
    const admin = bearer('studio-admin'); const editor = bearer('studio-editor'); const viewer = bearer('studio-viewer'); const noGrant = bearer('studio-no-grant'); const outsider = bearer('studio-outsider');
    app.setErrorHandler((error, _request, reply) => reply.code((error as { status?: number }).status || 500).send({ message: error.message }));
    for (const factory of [WorkspaceController, PresetController, StudioController]) {
        const controller = await factory({} as never);
        for (const method of await controller.methods(controller)) app.route({ method: method.type.toUpperCase() as any, url: `${controller.path}${method.path}`, handler: method.handler });
    }
    let workspaceId = ''; let siteId = '';
    async function request(path: string, token = admin, payload?: unknown, method?: 'GET' | 'POST' | 'PUT') {
        return app.inject({ url: path, method: method || (payload === undefined ? 'GET' : 'POST'), headers: { authorization: token,
            ...(workspaceId ? { 'x-bcms-workspace': workspaceId } : {}), ...(siteId ? { 'x-bcms-site': siteId } : {}) }, payload: payload as never });
    }
    async function ok(...args: Parameters<typeof request>) { const response = await request(...args); assert.equal(response.statusCode, 200, response.body); return response.json(); }
    assert.equal((await request('/api/v4/studio/site', '')).statusCode, 403);
    workspaceId = (await ok('/api/v4/workspaces', admin, { name: 'Studio isolated integration' }))._id;
    for (const [id, role] of [['studio-editor', 'editor'], ['studio-viewer', 'viewer'], ['studio-no-grant', 'editor']]) await ok(`/api/v4/workspaces/current/members/${id}`, admin, { role }, 'PUT');
    siteId = (await ok('/api/v4/workspaces/current/sites', admin, { name: 'Studio test site' }))._id;
    const installed = await ok('/api/v4/presets/import', admin, { presetId: 'aeroframe', siteName: 'Studio test site', includeDemo: true }) as SiteInstallation;
    const source = { workspace: Repo.workspace.methods.fresh, site: Repo.siteInstallation.methods.findFresh };
    const adminScope = await resolveWorkspaceContext({ userId: 'studio-admin', roles: ['ADMIN'] }, { workspaceId, siteId }, source);
    for (const id of ['studio-editor', 'studio-viewer']) {
        const user = (await Repo.user.findById(id))!;
        user.customPool.policy.templates = installed.models.map(model => ({ _id: model.templateId, get: true, post: true, put: true, delete: false }));
        user.customPool.policy.media = { get: true, post: false, put: false, delete: false };
        await Repo.user.update(user);
    }
    assert.equal((await request('/api/v4/studio/site', outsider)).statusCode, 403);
    assert.equal((await ok('/api/v4/studio/site', noGrant)).models.length, 0);
    assert.ok((await ok('/api/v4/studio/site', viewer)).models.every((model: any) => !model.canEdit && !model.canCreate));
    const mapping = installed.models.find(model => model.key === 'content-page')!;
    const original = await runWithWorkspace(adminScope, async () => {
        const template = (await Repo.template.findById(mapping.templateId))!;
        const extra = { ...PropFactory.string(), id: 'custom-unmapped', name: 'privateNotes', label: 'Private notes', required: false };
        template.props.push(extra); await Repo.template.update(template);
        const entry = (await Repo.entry.methods.findAllByTemplateId(mapping.templateId))[0];
        entry.meta[0].props.push({ id: extra.id, data: ['Unmapped field stays intact'] });
        const rich = entry.meta[0].props.find(prop => prop.id === mapping.fields.find(field => field.key === 'body')!.propId)!;
        rich.data = [{ nodes: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Styled body', marks: [{ type: 'bold' }] }] }] }] as never;
        entry.meta.push({ lng: 'zh', props: [{ id: mapping.fields.find(field => field.key === 'title')!.propId, data: ['保留中文'] }] });
        entry.content.push({ lng: 'zh', nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '保留正文' }] }] as never, plainText: '保留正文' });
        return Repo.entry.update(entry);
    });
    const selectedImage = await runWithWorkspace(adminScope, () => Repo.media.add(MediaFactory.create({ userId: 'studio-admin', type: MediaType.IMG, mimetype: 'image/png', size: 128,
        name: 'selected-image.png', isInRoot: true, parentId: '', hasChildren: false, altText: 'Accessible image', caption: '', width: 16, height: 16 })));
    const foreignImageId = randomUUID();
    await app.mongo.db!.collection(Repo.media.collection).insertOne({ ...selectedImage, _id: foreignImageId as never, workspaceId: 'foreign-workspace' });
    const contentUpdate = { operationId: randomUUID(), entryId: original._id, expectedUpdatedAt: original.updatedAt, fields: { title: 'Studio preserved update', cover: [{ _id: selectedImage._id, alt_text: 'Selected through Studio' }] } };
    assert.equal((await request('/api/v4/studio/entries/content-page', viewer, contentUpdate)).statusCode, 403);
    assert.equal((await request('/api/v4/studio/entries/content-page', noGrant, contentUpdate)).statusCode, 403);
    const saved = await ok('/api/v4/studio/entries/content-page', editor, contentUpdate);
    const after = await runWithWorkspace(adminScope, () => Repo.entry.findById(original._id));
    assert.ok(after);
    assert.equal((after.meta[0].props.find(prop => prop.id === mapping.fields.find(field => field.key === 'title')!.propId)!.data as string[])[0], 'Studio preserved update');
    const titleId = mapping.fields.find(field => field.key === 'title')!.propId;
    const coverId = mapping.fields.find(field => field.key === 'cover')!.propId;
    assert.deepEqual(after.meta[0].props.find(prop => prop.id === coverId)!.data, [{ _id: selectedImage._id, alt_text: 'Selected through Studio' }]);
    assert.deepEqual(after.meta[0].props.filter(prop => ![titleId, coverId].includes(prop.id)), original.meta[0].props.filter(prop => ![titleId, coverId].includes(prop.id)));
    assert.equal((await request('/api/v4/studio/entries/content-page', editor, { ...contentUpdate, expectedUpdatedAt: saved.updatedAt, fields: { cover: [{ _id: foreignImageId }] } })).statusCode, 400);
    assert.deepEqual(after.meta.slice(1), original.meta.slice(1));
    assert.deepEqual(after.content, original.content);
    assert.equal((await request('/api/v4/studio/entries/content-page', editor, { ...contentUpdate, fields: { title: 'Stale overwrite' } })).statusCode, 409);
    assert.equal((await request('/api/v4/studio/entries/content-page', editor, { ...contentUpdate, expectedUpdatedAt: saved.updatedAt, fields: { body: 'Flatten rich text' } })).statusCode, 400);
    assert.equal((await runWithWorkspace(adminScope, () => Repo.entry.findById(original._id)))!.updatedAt, saved.updatedAt);
    const state = await ok('/api/v4/studio/site', admin);
    const operationId = randomUUID();
    const pageInput = { operationId, expectedUpdatedAt: state.site.updatedAt, title: 'Shipping policy', path: '/shipping-policy', blueprintKey: 'content',
        fields: { title: 'Shipping policy content', slug: 'shipping-policy', summary: 'Shipping details', body: 'Plain new paragraphs\nSecond line' } as Record<string, StudioValue> };
    assert.equal((await request('/api/v4/studio/pages', editor, pageInput)).statusCode, 403);
    const beforeCount = await runWithWorkspace(adminScope, () => Repo.entry.count());
    const page = await ok('/api/v4/studio/pages', admin, pageInput);
    const retry = await ok('/api/v4/studio/pages', admin, pageInput);
    assert.equal(page.key, retry.key); assert.equal(page.entryId, retry.entryId);
    assert.equal(await runWithWorkspace(adminScope, () => Repo.entry.count()), beforeCount + 1);
    assert.equal((await request('/api/v4/studio/pages', admin, { ...pageInput, fields: { ...pageInput.fields, summary: 'Changed operation payload' } })).statusCode, 409);
    const fresh = await ok('/api/v4/studio/site');
    const conflicting = await request('/api/v4/studio/pages', admin, { ...pageInput, operationId: randomUUID(), expectedUpdatedAt: fresh.site.updatedAt, fields: { ...pageInput.fields, title: 'Conflicting route content' } });
    assert.equal(conflicting.statusCode, 400); assert.match(conflicting.body, /conflicts/);
    assert.equal(await runWithWorkspace(adminScope, () => Repo.entry.count()), beforeCount + 1);
    const settingsRequest = { expectedUpdatedAt: fresh.site.updatedAt, name: 'Renamed site', theme: { background: '#ffffff', foreground: '#182230', accent: '#2563eb', muted: '#e3e8ef' } };
    assert.equal((await request('/api/v4/studio/settings', editor, settingsRequest)).statusCode, 403);
    await ok('/api/v4/studio/settings', admin, settingsRequest);
    assert.equal((await request('/api/v4/studio/settings', admin, settingsRequest)).statusCode, 409);
    const current = await ok('/api/v4/studio/site'); assert.equal(current.site.name, 'Renamed site');
    const created = await runWithWorkspace(adminScope, () => Repo.entry.findById(page.entryId));
    assert.ok(created?.meta[0].props.find(prop => prop.id === mapping.fields.find(field => field.key === 'body')!.propId));
    assert.ok(!JSON.stringify(current).includes('gatewayPublishIntent'));
    assert.ok(current.models.find((model: any) => model.key === 'content-page').fields.find((field: any) => field.type === PropType.RICH_TEXT && !field.editable));
});
