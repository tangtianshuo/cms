import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { seedIdentity } from '../test-fixtures/identity';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { Config } from '../config';
import { Repo } from '../repo';
import { StorefrontController } from '../storefront/controller';
import { PresetController } from './controller';
import { ReleaseController } from './release-controller';
import type { SiteInstallation } from './site-model';

test('MongoDB and HTTP publication lifecycle preserves public content until activation and rollback', {
    skip: !process.env.STOREFRONT_TEST_MONGO,
    timeout: 60000,
}, async (context) => {
    const fastify = Fastify();
    const database = `storefront_release_test_${randomUUID().replaceAll('-', '')}`;
    let storefront: ChildProcess | undefined;
    let storefrontOutput = '';
    context.after(async () => {
        storefront?.kill();
        await fastify.mongo.db?.dropDatabase();
        await fastify.close();
    });
    await fastify.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database, forceClose: true });
    for (const repo of [Repo.workspace, Repo.user, Repo.siteInstallation, Repo.storefrontRelease, Repo.storefrontReleaseAudit,
        Repo.template, Repo.entryGroup, Repo.entry, Repo.language, Repo.media]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify,
            next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    await seedIdentity('integration-admin');
    JWTManager.setScopes([{ issuer: Config.jwtIssuer, secret: Config.jwtSecret, alg: 'HS256', expIn: 60000 }]);
    const token = JWTManager.create({ issuer: Config.jwtIssuer, userId: 'integration-admin', roles: ['ADMIN', 'USER'] });
    assert.ok(!(token instanceof JWTError));
    const authorization = `Bearer ${JWTEncode.encode(token)}`;
    fastify.setErrorHandler((error, _request, reply) => {
        reply.code((error as unknown as { status?: number }).status || 500).send({ message: error.message });
    });
    for (const factory of [PresetController, ReleaseController, StorefrontController]) {
        const controller = await factory({} as never);
        for (const method of await controller.methods(controller)) {
            fastify.route({ method: method.type.toUpperCase() as 'GET' | 'POST',
                url: `${controller.path}${method.path}`, handler: method.handler });
        }
    }
    const address = await fastify.listen({ host: '127.0.0.1', port: 0 });
    async function admin(url: string, body?: unknown) {
        const response = await fastify.inject({ url, method: body === undefined ? 'GET' : 'POST',
            headers: { authorization }, payload: body as never });
        assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
        return response.json();
    }
    async function publicPage(pagePath: string) {
        return fastify.inject({ url: `/api/v4/storefront/published?${new URLSearchParams({ path: pagePath })}`,
            headers: { 'x-storefront-host': Config.storefrontHost } });
    }
    const installed = await admin('/api/v4/presets/import', { presetId: 'atelier', siteName: 'Integration Store', includeDemo: true }) as SiteInstallation;
    assert.equal((await publicPage('/')).statusCode, 404);
    const legacy = await fastify.inject({ url: '/api/v4/storefront/products/featured-product',
        headers: { authorization, 'x-storefront-host': Config.storefrontHost } });
    assert.equal(legacy.statusCode, 404);
    const check = await admin('/api/v4/presets/releases/check', {});
    assert.equal(check.valid, true, JSON.stringify(check));
    const first = await admin('/api/v4/presets/releases/publish', { expectedReleaseId: '' });
    const original = (await publicPage('/')).json();
    assert.equal(original.releaseId, first.releaseId);
    const home = installed.models.find((model) => model.key === 'home')!;
    const entry = (await Repo.entry.methods.findAllByTemplateId(home.templateId))[0];
    const headline = home.fields.find((field) => field.key === 'headline')!.propId;
    entry.meta[0].props.find((prop) => prop.id === headline)!.data = ['Saved after first release'];
    await Repo.entry.update(entry);
    assert.deepEqual((await publicPage('/')).json(), original);
    const content = installed.models.find((model) => model.key === 'content-page')!;
    const contentEntry = (await Repo.entry.methods.findAllByTemplateId(content.templateId))[0];
    const newPage = await admin('/api/v4/presets/pages', { blueprintKey: 'content', title: 'Delivery',
        path: '/delivery', seoTitle: 'Delivery info', seoDescription: 'Shipping details',
        sections: ['story'], entryId: contentEntry._id, navigation: true, enabled: true });
    assert.equal((await publicPage('/delivery')).statusCode, 404);
    const second = await admin('/api/v4/presets/releases/publish', { expectedReleaseId: first.releaseId });
    assert.equal((await publicPage('/')).json().content.preset.demo.hero.title, 'Saved after first release');
    assert.equal((await publicPage('/delivery')).statusCode, 200);
    await admin(`/api/v4/presets/pages/${newPage.key}`, { title: 'Delivery', path: '/shipping',
        seoTitle: 'Delivery info', seoDescription: 'Shipping details', sections: ['story'],
        entryId: contentEntry._id, navigation: true, enabled: true });
    const third = await admin('/api/v4/presets/releases/publish', { expectedReleaseId: second.releaseId });
    assert.equal((await publicPage('/delivery')).json().redirect, '/shipping');
    assert.equal((await publicPage('/shipping')).statusCode, 200);
    const staleDraft = await Repo.siteInstallation.methods.findDefaultFresh();
    assert.ok(staleDraft);
    assert.equal(await Repo.siteInstallation.methods.activate(staleDraft, third.releaseId), true);
    assert.equal(await Repo.siteInstallation.methods.activate(staleDraft, first.releaseId), false);
    assert.equal(await Repo.siteInstallation.methods.saveDraft({ ...staleDraft, name: 'Stale write' }, staleDraft.updatedAt), false);
    assert.equal((await Repo.siteInstallation.methods.findDefaultFresh())?.currentReleaseId, third.releaseId);
    if (process.env.STOREFRONT_TEST_SSR === 'true') {
        const port = new URL(`http://${Config.storefrontHost}`).port;
        storefront = spawn(process.execPath, [path.resolve('../storefront/.output/server/index.mjs')], {
            env: { ...process.env, HOST: '127.0.0.1', PORT: port,
                NUXT_DOMAIN_PRODUCTION: 'false', NUXT_GATEWAY_SECRET: '',
                NUXT_CMS_INTERNAL_ORIGIN: address, NUXT_PUBLIC_SITE_HOST: Config.storefrontHost },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        storefront.stdout?.on('data', (data) => { storefrontOutput += String(data); });
        storefront.stderr?.on('data', (data) => { storefrontOutput += String(data); });
        const origin = `http://${Config.storefrontHost}`;
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            try { await fetch(origin); ready = true; break; }
            catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
        }
        assert.ok(ready, storefrontOutput);
        const homepage = await fetch(origin);
        assert.equal(homepage.status, 200, storefrontOutput);
        assert.equal(homepage.headers.get('cache-control'), 'no-store');
        assert.ok((await homepage.text()).includes('Saved after first release'));
        const product = await fetch(`${origin}/products/featured-product`);
        assert.equal(product.status, 200, storefrontOutput);
        assert.ok((await product.text()).includes('Integration Store'));
        const redirect = await fetch(`${origin}/delivery`, { redirect: 'manual' });
        assert.equal(redirect.status, 301);
        assert.equal(redirect.headers.get('location'), '/shipping');
        const sitemap = await fetch(`${origin}/sitemap.xml`);
        assert.equal(sitemap.status, 200);
        assert.ok((await sitemap.text()).includes('/shipping</loc>'));
        assert.equal((await fetch(`${origin}/unknown-draft`)).status, 404);
    }
    await admin('/api/v4/presets/releases/rollback', { releaseId: first.releaseId, expectedReleaseId: third.releaseId });
    assert.deepEqual((await publicPage('/')).json(), original);
    assert.equal((await publicPage('/shipping')).statusCode, 404);
    const records = await admin('/api/v4/presets/releases/');
    assert.equal(records.items.length, 3);
    assert.equal(records.currentReleaseId, first.releaseId);
    assert.ok(records.audit.some((event: { operation: string }) => event.operation === 'rollback'));
    const gatewayEnv = {
        GATEWAY_BASE_URL: 'http://127.0.0.1:3001', GATEWAY_WORKSPACE_ID: randomUUID(),
        GATEWAY_SITE_ID: randomUUID(), CMS_SERVICE_SECRET: 'integration-secret',
        GATEWAY_MANIFEST_CHECKSUM: `sha256:${'a'.repeat(64)}`,
        GATEWAY_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`, GATEWAY_EXPECTED_REVISION: '7',
    };
    const originalFetch = globalThis.fetch;
    const originalEnv = Object.fromEntries(Object.keys(gatewayEnv).map((key) => [key, process.env[key]]));
    try {
        Object.assign(process.env, gatewayEnv);
        const calls: string[] = [];
        globalThis.fetch = async (input, init) => {
            calls.push(String(input));
            assert.equal(init?.method, 'POST');
            return calls.length === 1 ? Response.json({}, { status: 201 })
                : Response.json({ id: 'operation-1', status: 'pending' }, { status: 202 });
        };
        const pending = await admin('/api/v4/presets/releases/publish', { target: 'gateway', expectedReleaseId: first.releaseId });
        assert.equal(pending.status, 'pending');
        assert.equal(pending.operationId, 'operation-1');
        assert.deepEqual(calls, [
            `${gatewayEnv.GATEWAY_BASE_URL}/api/v1/sites/${gatewayEnv.GATEWAY_SITE_ID}/releases`,
            `${gatewayEnv.GATEWAY_BASE_URL}/api/v1/sites/${gatewayEnv.GATEWAY_SITE_ID}/publish-operations`,
        ]);
        assert.equal((await admin('/api/v4/presets/releases/')).currentReleaseId, first.releaseId);
        globalThis.fetch = async (input) => String(input).endsWith('/releases')
            ? Response.json({}, { status: 201 }) : Response.json({}, { status: 409 });
        const conflict = await fastify.inject({ url: '/api/v4/presets/releases/publish', method: 'POST',
            headers: { authorization }, payload: { target: 'gateway', expectedReleaseId: first.releaseId } });
        assert.equal(conflict.statusCode, 409, conflict.body);
        assert.match(conflict.json().message, /revision conflict/i);
        assert.equal((await admin('/api/v4/presets/releases/')).currentReleaseId, first.releaseId);
    } finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
    const wrongHost = await fastify.inject({ url: '/api/v4/storefront/published?path=/',
        headers: { 'x-storefront-host': 'another.test' } });
    assert.equal(wrongHost.statusCode, 404);
});
