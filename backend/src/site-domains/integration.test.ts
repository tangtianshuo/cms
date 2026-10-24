import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { seedIdentity } from '../test-fixtures/identity';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { getPreset } from '../presets/catalog';
import { challengeSignature } from './service';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { JWTManager, JWTEncode, JWTError } from '../_server/modules/jwt';
import { Config } from '../config';
import { SiteDomainController } from './controller';
import { StorefrontController } from '../storefront/controller';
import { domainService, flushDomainAudits } from './source';
import type { SiteInstallation } from '../presets/site-model';

test('real Mongo unique domain ownership, primary concurrency, HTTP trust and immutable publication', {
    skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 30000,
}, async (context) => {
    const fastify = Fastify();
    const database = `cms_domain_test_${randomUUID().replaceAll('-', '')}`;
    await fastify.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database, forceClose: true });
    let storefront: ChildProcess | undefined;
    context.after(async () => { storefront?.kill(); await fastify.mongo.db?.dropDatabase(); await fastify.close(); });
    for (const repo of [Repo.workspace, Repo.user, Repo.media, Repo.siteInstallation, Repo.siteDomain, Repo.siteDomainAudit, Repo.storefrontRelease]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    await seedIdentity('domain-admin');
    JWTManager.setScopes([{ issuer: Config.jwtIssuer, secret: Config.jwtSecret, alg: 'HS256', expIn: 60000 }]);
    const token = JWTManager.create({ issuer: Config.jwtIssuer, userId: 'domain-admin', roles: ['ADMIN', 'USER'] });
    assert.ok(!(token instanceof JWTError));
    const authorization = `Bearer ${JWTEncode.encode(token)}`;
    fastify.setErrorHandler((error, _request, reply) => reply.code((error as unknown as { status?: number }).status || 500).send({ message: error.message }));
    for (const factory of [SiteDomainController, StorefrontController]) {
        const controller = await factory({} as never);
        for (const method of await controller.methods(controller)) fastify.route({ method: method.type.toUpperCase() as 'GET' | 'POST' | 'DELETE', url: `${controller.path}${method.path}`, handler: method.handler });
    }
    const site = { _id: 'site', slot: 'default', name: 'Store', createdAt: 1, updatedAt: 1, currentReleaseId: 'release' } as SiteInstallation;
    await Repo.siteInstallation.add(site, true);
    await Repo.storefrontRelease.add({ _id: 'release', siteId: 'site', createdAt: 1, updatedAt: 1, createdBy: 'admin', previousReleaseId: '', payload: JSON.stringify({ schemaVersion: 1, siteId: 'site', pages: [{ path: '/', content: { seo: { title: 'Published', description: 'Published content' }, preset: getPreset('atelier'), view: 'home' } }], navigation: [], redirects: [], language: 'en' }) }, true);
    const service = domainService();
    const one = await service.add('one.test', 'admin');
    const two = await service.add('two.test', 'admin');
    await assert.rejects(async () => Repo.siteDomain.add({ ...(await Repo.siteDomain.methods.findId(one.domain._id))!, _id: 'foreign', siteId: 'other' }, true), (error: unknown) => (error as { code?: number }).code === 11000);
    for (const item of [one, two]) await service.check(item.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    const switched = await Promise.allSettled([service.primary(one.domain._id, 'admin'), service.primary(two.domain._id, 'admin')]);
    assert.equal(switched.filter((result) => result.status === 'fulfilled').length, 1);
    const current = (await Repo.siteInstallation.methods.findDefaultFresh())!;
    const primary = (await Repo.siteDomain.methods.findId(current.primaryDomainId!))!;
    const alias = primary.hostname === 'one.test' ? two.domain : one.domain;
    const staleDraft = { ...site, name: 'Edited' };
    assert.equal(await Repo.siteInstallation.methods.saveDraft(staleDraft, site.updatedAt), true);
    assert.equal((await Repo.siteInstallation.methods.findDefaultFresh())?.primaryDomainId, primary._id);
    async function publicPage(host: string, key?: string) {
        return fastify.inject({ url: '/api/v4/storefront/published?path=/', headers: { 'x-storefront-host': host, ...(key ? { 'x-storefront-key': key } : {}) } });
    }
    assert.equal((await publicPage(primary.hostname)).statusCode, 404);
    assert.equal((await publicPage(primary.hostname, 'wrong')).statusCode, 404);
    const response = await publicPage(alias.hostname, Config.storefrontGatewaySecret);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().origin, `https://${primary.hostname}`);
    assert.equal((await publicPage('unknown.test', Config.storefrontGatewaySecret)).statusCode, 404);
    assert.equal((await fastify.inject({ url: '/api/v4/site-domains' })).statusCode, 403);
    const listed = await fastify.inject({ url: '/api/v4/site-domains', headers: { authorization } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().items.filter((item: { isPrimary: boolean }) => item.isPrimary).length, 1);
    assert.equal(listed.body.includes('verificationTokenHash'), false);
    const disablePrimary = await fastify.inject({ method: 'POST', url: `/api/v4/site-domains/${primary._id}/state`, headers: { authorization }, payload: { enabled: false } });
    assert.equal(disablePrimary.statusCode, 400);
    if (process.env.STOREFRONT_TEST_SSR === 'true') {
        const address = await fastify.listen({ host: '127.0.0.1', port: 0 });
        const reserve = createServer();
        await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve));
        const port = (reserve.address() as { port: number }).port;
        await new Promise<void>((resolve) => reserve.close(() => resolve()));
        let output = '';
        storefront = spawn(process.execPath, [path.resolve('../storefront/.output/server/index.mjs')], {
            env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_CMS_INTERNAL_ORIGIN: address,
                NUXT_GATEWAY_SECRET: Config.storefrontGatewaySecret, NUXT_DOMAIN_SECRET: Config.storefrontDomainSecret, NUXT_DOMAIN_PRODUCTION: 'true' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        storefront.stdout?.on('data', (data) => { output += String(data); });
        storefront.stderr?.on('data', (data) => { output += String(data); });
        const origin = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 100; i++) {
            try { await fetch(origin); break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
        }
        async function gatewayFetch(url: string, options: { headers?: Record<string, string>; redirect?: string } = {}): Promise<Response> {
            return new Promise((resolve, reject) => {
                const req = httpRequest(url, { headers: options.headers }, (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers as Record<string, string> })));
                });
                req.on('error', reject); req.end();
            });
        }
        const gatewayHeaders = (host: string) => ({ host, 'x-storefront-host': host, 'x-storefront-key': Config.storefrontGatewaySecret });
        const apiFirst = await gatewayFetch(`${origin}/api/published?path=/`, { headers: gatewayHeaders(primary.hostname) });
        assert.equal(apiFirst.status, 200, await apiFirst.text());
        const html = await gatewayFetch(origin, { headers: gatewayHeaders(primary.hostname) });
        const body = await html.text();
        assert.equal(html.status, 200, `${body}\n${output}`);
        assert.equal(html.headers.get('cache-control'), 'no-store');
        assert.ok(body.includes(`rel="canonical" href="https://${primary.hostname}/"`), body);
        const aliasPage = await gatewayFetch(`${origin}/?campaign=test`, { headers: gatewayHeaders(alias.hostname), redirect: 'manual' });
        assert.equal(aliasPage.status, 301);
        assert.equal(aliasPage.headers.get('location'), `https://${primary.hostname}/?campaign=test`);
        const sitemap = await gatewayFetch(`${origin}/sitemap.xml`, { headers: gatewayHeaders(primary.hostname) });
        assert.equal(sitemap.status, 200);
        assert.ok((await sitemap.text()).includes(`https://${primary.hostname}/</loc>`));
        const api = await gatewayFetch(`${origin}/api/published?path=/`, { headers: gatewayHeaders(alias.hostname), redirect: 'manual' });
        assert.equal(api.status, 200);
        assert.equal((await api.json() as { primaryHostname: string }).primaryHostname, primary.hostname);
        const nonce = 'a'.repeat(48);
        const challenge = await gatewayFetch(`${origin}/.well-known/cms-domain-challenge?nonce=${nonce}`, { headers: gatewayHeaders(alias.hostname), redirect: 'manual' });
        assert.equal(challenge.status, 200);
        assert.equal(await challenge.text(), challengeSignature(alias.hostname, nonce, Config.storefrontDomainSecret));
        assert.equal((await gatewayFetch(origin, { headers: { host: primary.hostname, 'x-forwarded-host': primary.hostname } })).status, 404);
        assert.equal((await gatewayFetch(origin, { headers: gatewayHeaders('unknown.test') })).status, 404);
        assert.equal((await gatewayFetch(origin, { headers: gatewayHeaders(primary.hostname) })).status, 200);
        await service.primary(alias._id, 'admin');
        const changed = await gatewayFetch(origin, { headers: gatewayHeaders(alias.hostname) });
        assert.equal(changed.status, 200);
        assert.ok((await changed.text()).includes(`rel="canonical" href="https://${alias.hostname}/"`));
        assert.equal((await gatewayFetch(origin, { headers: gatewayHeaders(primary.hostname), redirect: 'manual' })).headers.get('location'), `https://${alias.hostname}/`);
        assert.equal((await gatewayFetch(`${origin}/sitemap.xml`, { headers: gatewayHeaders(primary.hostname) })).status, 301);
        await service.primary(primary._id, 'admin');
    }
    // Mongo validators reject the actual durable audit write, exercising the
    // same single-document commit as the pointer without replica-set transactions.
    const beforeFailedAudit = (await Repo.siteInstallation.methods.findFresh('site'))!;
    await fastify.mongo.db!.command({ collMod: Repo.siteInstallation.collection,
        validator: { $nor: [{ 'domainAuditOutbox.domainId': alias._id }] }, validationAction: 'error' });
    const failedPromotion = await fastify.inject({ method: 'POST', url: `/api/v4/site-domains/${alias._id}/primary`, headers: { authorization }, payload: {} });
    assert.equal(failedPromotion.statusCode, 400, failedPromotion.body);
    const afterFailedAudit = (await Repo.siteInstallation.methods.findFresh('site'))!;
    assert.equal(afterFailedAudit.primaryDomainId, primary._id);
    assert.equal(afterFailedAudit.domainRevision, beforeFailedAudit.domainRevision);
    assert.deepEqual(afterFailedAudit.domainAuditOutbox, beforeFailedAudit.domainAuditOutbox);
    await fastify.mongo.db!.command({ collMod: Repo.siteInstallation.collection, validator: {} });

    await fastify.mongo.db!.command({ collMod: Repo.siteDomainAudit.collection,
        validator: { $nor: [{ operation: 'primary', domainId: alias._id }] }, validationAction: 'error' });
    const projectionLog = context.mock.method(console, 'error', () => undefined);
    const committedPromotion = await fastify.inject({ method: 'POST', url: `/api/v4/site-domains/${alias._id}/primary`, headers: { authorization }, payload: {} });
    assert.equal(committedPromotion.statusCode, 200, committedPromotion.body);
    const durableSite = (await Repo.siteInstallation.methods.findFresh('site'))!;
    assert.equal(durableSite.primaryDomainId, alias._id);
    assert.equal(durableSite.domainAuditOutbox?.length, 1);
    const durableEvent = durableSite.domainAuditOutbox![0];
    assert.equal(durableEvent.domainId, alias._id);
    assert.equal(durableEvent.siteId, 'site');
    assert.equal(durableEvent.actorId, 'domain-admin');
    assert.equal(durableEvent.operation, 'primary');
    assert.equal(durableEvent.outcome, 'committed');
    assert.equal(durableEvent.bindingRevision, durableSite.domainRevision);
    assert.equal((await Repo.siteDomainAudit.findAll()).filter((event) => event._id === durableEvent._id).length, 0);
    assert.equal(await Repo.siteInstallation.methods.saveDraft({ ...durableSite, name: 'Edit with stale outbox', domainAuditOutbox: [] }, durableSite.updatedAt), true);
    assert.equal((await Repo.siteInstallation.methods.findFresh('site'))?.domainAuditOutbox?.[0]._id, durableEvent._id);
    await Repo.siteInstallation.methods.updateImport({ ...durableSite, name: 'Import resume with stale outbox', domainAuditOutbox: [] });
    assert.equal((await Repo.siteInstallation.methods.findFresh('site'))?.domainAuditOutbox?.[0]._id, durableEvent._id);
    assert.equal((await Repo.siteInstallation.methods.findFresh('site'))?.primaryDomainId, alias._id);
    await fastify.mongo.db!.command({ collMod: Repo.siteDomainAudit.collection, validator: {} });
    await Promise.all([flushDomainAudits('site'), flushDomainAudits('site')]);
    await flushDomainAudits('site');
    assert.equal((await Repo.siteInstallation.methods.findFresh('site'))?.domainAuditOutbox?.length, 0);
    assert.equal((await Repo.siteDomainAudit.findAll()).filter((event) => event._id === durableEvent._id).length, 1);
    projectionLog.mock.restore();
    await service.primary(primary._id, 'admin');
    await service.remove(alias._id, 'admin');
    assert.equal((await publicPage(alias.hostname, Config.storefrontGatewaySecret)).statusCode, 404);
    const rebound = await service.add(alias.hostname, 'admin');
    assert.notEqual(rebound.txtValue, alias.hostname === one.domain.hostname ? one.txtValue : two.txtValue);
    assert.equal((await publicPage(alias.hostname, Config.storefrontGatewaySecret)).statusCode, 404);
    assert.equal((await publicPage(primary.hostname, Config.storefrontGatewaySecret)).json().releaseId, 'release');
    await Repo.siteDomain.methods.replace({ ...(await Repo.siteDomain.methods.findId(rebound.domain._id))!, verificationExpiresAt: Date.now() - 8 * 86400000 }, rebound.domain.updatedAt);
    assert.equal(await Repo.siteDomain.methods.cleanupExpired(), 1);
    assert.equal(await Repo.siteDomain.methods.findId(rebound.domain._id), null);
    const sites = fastify.mongo.db!.collection<SiteInstallation>(Repo.siteInstallation.collection);
    await sites.updateOne({ _id: 'site' }, { $set: { domainMutationUntil: 1, domainMutationToken: 'crashed' } });
    await service.primary(primary._id, 'admin');
    assert.equal((await Repo.siteInstallation.methods.findDefaultFresh())?.domainMutationToken, undefined);
    assert.ok((await Repo.siteDomainAudit.findAll()).some((event) => event.operation === 'primary'));
    const beforePromotion = (await Repo.siteDomain.methods.findId(primary._id))!;
    await service.primary(primary._id, 'admin');
    assert.equal(await Repo.siteDomain.methods.remove(primary._id, beforePromotion.updatedAt), false);
    await assert.rejects(() => Repo.siteInstallation.methods.withDomainLock('site', async () => {
        await sites.updateOne({ _id: 'site' }, { $set: { domainMutationToken: 'replacement-owner' } });
        await Repo.siteInstallation.methods.setPrimaryDomain('site', 'stale-writer', {
            _id: 'stale-event', createdAt: Date.now(), updatedAt: Date.now(), siteId: 'site', domainId: 'stale-writer', actorId: 'admin',
            operation: 'primary', outcome: 'committed', error: '', bindingRevision: ((await Repo.siteInstallation.methods.findFresh('site'))?.domainRevision || 0) + 1,
        });
    }), /changed/i);
    assert.equal((await Repo.siteInstallation.methods.findDefaultFresh())?.primaryDomainId, primary._id);
});
