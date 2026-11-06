import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Config } from '../config';
import { Repo } from '../repo';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { seedIdentity } from '../test-fixtures/identity';
import { keyValueStore } from '../key-value-store';
import { ReleaseController } from './release-controller';
import { PresetController } from './controller';
import { StudioController } from '../studio/controller';
import { canonicalJson } from './registry';
import type { SiteInstallation } from './site-model';
import type { ReleaseSnapshot } from './releases';
test.after(() => keyValueStore.destroy());

test('authenticated observation blocks pending without mutation and binds ready authority to immutable content', {
    skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 60000,
}, async context => {
    const app = Fastify(), gateway = Fastify();
    const calls: string[] = [], writes: string[] = [];
    const database = `b3_observation_${randomUUID().replaceAll('-', '')}`;
    const mongoUrl = process.env.STOREFRONT_TEST_MONGO; assert.ok(mongoUrl);
    await app.register(fastifyMongo, { url: mongoUrl, database, forceClose: true, monitorCommands: true });
    context.after(async () => { await app.mongo.db?.dropDatabase(); await app.close(); await gateway.close(); });
    for (const repo of [Repo.workspace, Repo.user, Repo.siteInstallation, Repo.storefrontRelease, Repo.storefrontReleaseAudit, Repo.media]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app,
            next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    await seedIdentity('observation-admin'); await seedIdentity('observation-user', 'USER');
    JWTManager.setScopes([{ issuer: Config.jwtIssuer, secret: Config.jwtSecret, alg: 'HS256', expIn: 60000 }]);
    const authorization = (userId: string) => {
        const token = JWTManager.create({ issuer: Config.jwtIssuer, userId, roles: ['ADMIN', 'USER'] });
        assert.ok(!(token instanceof JWTError)); return `Bearer ${JWTEncode.encode(token)}`;
    };
    const cmsSiteId = randomUUID(), gatewaySiteId = randomUUID(), workspaceId = randomUUID(), marker = 'B3-PUBLISHED-HOME';
    const digest = `sha256:${'a'.repeat(64)}`;
    const manifest = { id: 'aeroframe', version: '1.0.4', models: [], pages: [], demo: { hero: { title: marker } } };
    const manifestChecksum = 'sha256:' + createHash('sha256').update(canonicalJson(manifest)).digest('hex');
    const template = { schemaVersion: 1, id: 'aeroframe', version: '1.0.4', manifestChecksum,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe', imageDigest: digest,
        sourceCommit: 'b'.repeat(40), manifestPath: 'templates/aeroframe/1.0.4/template.json', status: 'available' };
    const snapshot = { schemaVersion: 1, workspaceId, siteId: gatewaySiteId, language: 'en',
        pages: [{ path: '/', pageKey: 'home', entryId: 'home-entry', content: { kind: 'preset-page', view: 'home',
            preset: { id: 'aeroframe', version: '1.0.4', demo: { hero: { title: marker } } }, sections: ['hero'] } }],
        navigation: [], redirects: [] } as unknown as ReleaseSnapshot;
    const bytes = JSON.stringify(snapshot), checksum = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const intent = { releaseId: 'release-1', expectedReleaseId: '', requestKey: randomUUID(), idempotencyKey: randomUUID(),
        revision: 6, snapshot: Buffer.from(bytes).toString('base64'), checksum, record: template, status: 'pending' };
    const site = await Repo.siteInstallation.add({ _id: cmsSiteId, workspaceId: 'default', createdAt: 1, updatedAt: 1,
        slot: 'default', name: 'Observation test', presetId: 'aeroframe', presetVersion: '1.0.4', status: 'ready',
        importError: '', includeDemo: false, demoSeeded: false, models: [], pages: [],
        theme: { background: '#ffffff', foreground: '#111111', accent: '#123456', muted: '#888888', font: 'Arial, sans-serif' },
        gatewayPublishIntent: JSON.stringify(intent), publishedTemplateRecord: JSON.stringify(template),
        presetManifestSnapshot: JSON.stringify(manifest),
    } as SiteInstallation, true);
    const release = await Repo.storefrontRelease.add({ _id: 'release-1', workspaceId: 'default', siteId: cmsSiteId,
        createdAt: 1, updatedAt: 1, createdBy: 'observation-admin', previousReleaseId: '', target: 'gateway',
        payload: JSON.stringify({ ...snapshot, workspaceId: 'default', siteId: cmsSiteId }), artifactPayload: bytes, templateRecord: JSON.stringify(template),
    }, true);
    let state: any = { revision: 7, active: { releaseId: 'release-1', routeRevision: 7, imageDigest: digest,
        createdAt: new Date(1000).toISOString(), metadata: { templateId: template.id, templateVersion: template.version,
            imageDigest: digest, manifestChecksum, imageRepository: template.imageRepository, sourceCommit: template.sourceCommit }, snapshot } };
    let available = true;
    gateway.all('/*', async (request, reply) => {
        calls.push(request.method); if (!available) return reply.code(503).send({ error: 'private diagnostic' });
        assert.equal(request.url, `/api/v1/sites/${gatewaySiteId}/publication-state`); assert.equal(request.method, 'GET'); return state;
    });
    const address = await gateway.listen({ host: '127.0.0.1', port: 0 });
    const previous = Object.fromEntries(['GATEWAY_BASE_URL', 'CMS_SERVICE_SECRET', 'GATEWAY_SITE_BINDINGS'].map(key => [key, process.env[key]]));
    process.env.GATEWAY_BASE_URL = address; process.env.CMS_SERVICE_SECRET = 'observation-private-service-secret';
    process.env.GATEWAY_SITE_BINDINGS = JSON.stringify([{ cmsWorkspaceId: 'default', cmsSiteId, workspaceId, siteId: gatewaySiteId, siteUrl: 'https://shop.example.com' }]);
    context.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    app.setErrorHandler((error, _request, reply) => reply.code((error as unknown as { status?: number }).status || 500).send({ message: error.message }));
    const controller = await ReleaseController({} as never);
    for (const method of await controller.methods(controller)) app.route({ method: method.type.toUpperCase() as 'GET' | 'POST', url: controller.path + method.path, handler: method.handler });
    for (const factory of [PresetController, StudioController]) {
        const setupController = await factory({} as never);
        const method = (await setupController.methods(setupController)).find(method => method.path === '/site'); assert.ok(method);
        app.route({ method: 'GET', url: setupController.path + method.path, handler: method.handler });
    }

    app.mongo.client.on('commandStarted', event => { if (['insert', 'update', 'delete', 'findAndModify', 'create', 'createIndexes'].includes(event.commandName)) writes.push(event.commandName); });
    const observe = (value = marker, headers: Record<string, string> = {}) => app.inject({
        url: '/api/v4/presets/releases/gateway/observation?' + new URLSearchParams({ marker: value }),
        headers: { authorization: authorization('observation-admin'), 'x-bcms-workspace': 'default', 'x-bcms-site': cmsSiteId, ...headers },
    });
    const { readAndVerifyPublication } = await new Function('url', 'return import(url)')(
        pathToFileURL(resolvePath(__dirname, '../../../ops/e2e/publication-observation.mjs')).href);
    const expected = { releaseId: 'release-1', activeRevision: 7, templateId: 'aeroframe', templateVersion: '1.0.4',
        workspaceId: 'default', siteId: cmsSiteId, siteUrl: 'https://shop.example.com/', marker };
    const requests: string[] = [];
    const verify = (override = {}) => readAndVerifyPublication(async (request: { method: 'GET'; url: string }) => {
        assert.equal(request.method, 'GET'); requests.push(request.url.split('?')[0]);
        const result = await app.inject({ ...request, headers: { authorization: authorization('observation-admin'),
            'x-bcms-workspace': 'default', 'x-bcms-site': cmsSiteId } });
        assert.equal(result.statusCode, 200); return result.json();
    }, { ...expected, ...override });
    const before = await Repo.siteInstallation.methods.findFresh(cmsSiteId); calls.length = 0; writes.length = 0;
    // These are the exact overview + installation reads performed before the browser PUBLISH case.
    for (const url of ['/api/v4/studio/site', '/api/v4/presets/site']) {
        const result = await app.inject({ url, headers: { authorization: authorization('observation-admin'),
            'x-bcms-workspace': 'default', 'x-bcms-site': cmsSiteId } });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(result.json().site.presetId, 'aeroframe'); assert.equal(result.json().site.presetVersion, '1.0.4');
    }
    await assert.rejects(() => verify(), /observation did not match/);
    assert.deepEqual(requests, ['/api/v4/presets/releases/gateway/observation']);
    assert.deepEqual(calls, []); assert.deepEqual(writes, []);

    const pending = await observe(); assert.equal(pending.statusCode, 200, pending.body); assert.equal(pending.json().status, 'blocked');
    assert.equal(pending.json().reason, 'publication_incomplete'); assert.deepEqual(calls, []); assert.deepEqual(writes, []);
    assert.deepEqual(await Repo.siteInstallation.methods.findFresh(cmsSiteId), before);
    assert.equal((await Repo.storefrontReleaseAudit.methods.findBySite(cmsSiteId)).length, 0);
    await Repo.siteInstallation.update({ ...site, gatewayPublishIntent: JSON.stringify({ ...intent, status: 'ready', operationId: 'op-7' }),
        gatewayCurrentReleaseId: 'release-1', gatewayActiveRevision: 7, gatewayPublishedReleaseIds: ['release-1'] });
    writes.length = 0; calls.length = 0;
    assert.equal((await verify()).releaseId, 'release-1');
    await assert.rejects(() => verify({ activeRevision: 8 }));
    await assert.rejects(() => verify({ releaseId: 'wrong-release' }));
    assert.deepEqual(calls, ['GET', 'GET', 'GET']); assert.deepEqual(writes, []);
    assert.ok(requests.every(url => url === '/api/v4/presets/releases/gateway/observation'));
    calls.length = 0;
    const ready = await observe(); assert.equal(ready.statusCode, 200, ready.body); assert.equal(ready.json().status, 'ready');
    assert.equal(ready.json().releaseId, 'release-1'); assert.equal(ready.json().activeRevision, 7); assert.equal(ready.json().template.id, 'aeroframe');
    assert.equal(ready.json().publishedHome.containsMarker, true);
    assert.equal(ready.json().publishedHome.markerChecksum, 'sha256:' + createHash('sha256').update(marker).digest('hex'));
    assert.deepEqual(calls, ['GET']); assert.deepEqual(writes, []);
    assert.equal(ready.body.includes('observation-private-service-secret'), false); assert.equal(ready.body.includes(marker), false); assert.equal(ready.body.includes('home-entry'), false);
    for (const change of [
        (value: any) => { value.active.releaseId = 'other-release'; },
        (value: any) => { value.active.routeRevision = 6; },
        (value: any) => { value.active.snapshot.siteId = randomUUID(); },
        (value: any) => { value.active.metadata.imageDigest = `sha256:${'c'.repeat(64)}`; },
        (value: any) => { value.active.snapshot.pages[0].content.preset.demo.hero.title = 'tampered'; },
    ]) {
        const saved = structuredClone(state); change(state); writes.length = 0; calls.length = 0;
        const result = await observe(); assert.equal(result.json().status, 'blocked', result.body);
        assert.deepEqual(calls, ['GET']); assert.deepEqual(writes, []); state = saved;
    }
    await Repo.storefrontRelease.update({ ...release, payload: JSON.stringify({ ...snapshot, workspaceId: 'other', siteId: cmsSiteId }) });
    writes.length = 0; assert.equal((await observe()).json().status, 'blocked'); assert.deepEqual(writes, []); await Repo.storefrontRelease.update(release);
    available = false; writes.length = 0; assert.equal((await observe()).json().status, 'unavailable'); assert.deepEqual(writes, []); available = true;
    for (const value of ['', 'x'.repeat(257)]) assert.equal((await observe(value)).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/v4/presets/releases/gateway/observation?marker=x&marker=y', headers: { authorization: authorization('observation-admin') } })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/v4/presets/releases/gateway/observation' })).statusCode, 403);
    assert.equal((await observe(marker, { authorization: authorization('observation-user') })).statusCode, 403);
    assert.equal((await observe(marker, { 'x-bcms-workspace': 'other' })).statusCode, 403);
});
