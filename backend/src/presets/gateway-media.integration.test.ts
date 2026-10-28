import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import '@fastify/multipart';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { keyValueStore } from '../key-value-store';
test.after(() => keyValueStore.destroy());
import { MediaFactory } from '../media/factory';
import { MediaType } from '../media/models/main';
import { MediaController } from '../media/controller';
import { MediaStorage } from '../media/storage';
import { claimMediaDeletion, MediaRetentionError } from '../media/retention';
import { retainedPublicMedia } from '../media/access';
import { releaseSource } from './release-source';
import { publishGatewayRelease } from './gateway-publish';
import { recoverGatewayPublication } from './gateway-recovery';
import type { ReleaseSnapshot } from './releases';
import type { SiteInstallation } from './site-model';

test('real Mongo and anonymous HTTP keep Gateway candidates private and retain active/history media', {
    skip: !process.env.STOREFRONT_TEST_MONGO, timeout: 60000,
}, async context => {
    const app = Fastify();
    await app.register(fastifyMongo, { url: process.env.STOREFRONT_TEST_MONGO!, database: `gateway_media_${randomUUID().replaceAll('-', '')}`, forceClose: true });
    context.after(async () => { await app.mongo.db?.dropDatabase(); await app.close(); });
    for (const repo of [Repo.siteInstallation, Repo.storefrontRelease, Repo.storefrontReleaseAudit, Repo.media]) {
        await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: app, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    }
    app.setErrorHandler((error, _request, reply) => reply.code((error as any).status || 500).send({ message: error.message }));
    const controller = await MediaController({} as never);
    const methods = await controller.methods(controller);
    const binary = methods.find(method => method.path.includes(':filename'))!;
    assert.ok(binary);
    app.route({ method: 'GET', url: `${controller.path}${binary.path}`, handler: binary.handler });
    context.mock.method(MediaStorage, 'readStream', async () => Readable.from(Buffer.from('test-image')) as never);
    const images = await Promise.all(['one', 'two', 'failed', 'partial'].map(name => Repo.media.add(MediaFactory.create({
        userId: 'publisher', type: MediaType.IMG, mimetype: 'image/png', size: 10, name, isInRoot: true,
        hasChildren: false, parentId: '', altText: '', caption: '', width: 1, height: 1,
    }))));
    const digest = `sha256:${'a'.repeat(64)}`;
    const template = { schemaVersion: 1, id: 'aeroframe', version: '1.0.3', manifestChecksum: digest,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe', imageDigest: digest,
        sourceCommit: 'a'.repeat(40), manifestPath: 'templates/aeroframe/1.0.3/template.json', status: 'available' };
    const site = await Repo.siteInstallation.add({ _id: randomUUID(), createdAt: 1, updatedAt: 1, workspaceId: 'default',
        slot: 'default', name: 'Media test', presetId: 'aeroframe', presetVersion: '1.0.3', status: 'ready', importError: '',
        includeDemo: false, demoSeeded: false, models: [], pages: [], theme: { background: '#ffffff', foreground: '#111111', accent: '#123456', muted: '#888888', font: 'Arial, sans-serif' },
        publishedTemplateRecord: JSON.stringify(template), presetManifestSnapshot: JSON.stringify({ id: 'aeroframe', version: '1.0.3' }),
    } as SiteInstallation, true);
    const config = { gatewayBaseUrl: 'http://127.0.0.1:3001', workspaceId: randomUUID(), siteId: randomUUID(), serviceSecret: 'test',
        cmsWorkspaceId: 'default', cmsSiteId: site._id, siteUrl: 'https://test.invalid' };
    let active: any = null;
    let revision = 0;
    let operationStatus = 'pending';
    const operations = new Map<string, any>();
    const snapshots = new Map<string, any>();
    const fetcher: typeof fetch = async (url, init) => {
        const path = String(url);
        if (path.endsWith('/publication-state')) return Response.json({ revision, active });
        if (path.endsWith('/template-pin')) return Response.json({ ...template, templateId: template.id, templateVersion: template.version });
        if (path.endsWith('/releases')) { const data = JSON.parse(String(init?.body)); snapshots.set(data.releaseId, JSON.parse(Buffer.from(data.snapshot, 'base64').toString())); return Response.json({}); }
        if (path.endsWith('/publish-operations')) {
            const data = JSON.parse(String(init?.body)); revision++;
            const op = { id: `op-${revision}`, releaseId: data.releaseId, revision, status: 'pending' }; operations.set(op.id, op); return Response.json(op);
        }
        const op = operations.get(path.split('/').at(-1)!);
        if (op) return Response.json({ ...op, status: operationStatus, ...(operationStatus === 'failed' ? { failureCode: 'readiness_failed' } : {}) });
        throw new Error(`Unexpected ${path}`);
    };
    const source = releaseSource();
    const publicImage = (id: string) => app.inject({ url: `/api/v4/media/${id}/bin/image.png` });
    const build = (id: string) => () => ({ schemaVersion: 1, workspaceId: 'default', siteId: site._id, language: 'en',
        pages: [{ path: '/', content: { image: `http://cms.invalid/api/v4/media/${id}/bin/image.png` } }], navigation: [], redirects: [] } as unknown as ReleaseSnapshot);
    const first = await publishGatewayRelease(source, 'publisher', '', randomUUID(), config, fetcher, build(images[0]._id));
    assert.equal((await publicImage(images[0]._id)).statusCode, 404);
    await assert.rejects(() => claimMediaDeletion([images[0]._id]), /retained/);
    async function confirm(result: typeof first) {
        operationStatus = 'ready';
        active = { releaseId: result.releaseId, imageDigest: digest, routeRevision: revision, createdAt: new Date().toISOString(),
            metadata: { templateId: template.id, templateVersion: template.version, ...template }, snapshot: snapshots.get(result.releaseId) };
        await recoverGatewayPublication(source, config, fetcher);
    }
    await confirm(first);
    assert.equal((await publicImage(images[0]._id)).statusCode, 200);
    assert.ok(await retainedPublicMedia(images[0]._id));
    assert.equal((await source.findSite())?.currentReleaseId, undefined);
    operationStatus = 'pending';
    const second = await publishGatewayRelease(source, 'next-publisher', first.releaseId, randomUUID(), config, fetcher, build(images[1]._id));
    await confirm(second);
    assert.equal((await publicImage(images[0]._id)).statusCode, 200, 'history stays public for rollback');
    assert.equal((await publicImage(images[1]._id)).statusCode, 200);
    operationStatus = 'pending';
    const failed = await publishGatewayRelease(source, 'failed-publisher', second.releaseId, randomUUID(), config, fetcher, build(images[2]._id));
    operationStatus = 'failed';
    await recoverGatewayPublication(source, config, fetcher);
    assert.equal((await publicImage(images[2]._id)).statusCode, 404);
    assert.equal((await source.findSite())?.gatewayCurrentReleaseId, second.releaseId);
    await assert.rejects(() => claimMediaDeletion([images[2]._id]), /retained/);
    const audits = await Repo.storefrontReleaseAudit.methods.findBySite(site._id);
    assert.ok(audits.some(event => event.releaseId === failed.releaseId && event.error));
    assert.ok(audits.some(event => event.releaseId === first.releaseId && event.actorId === 'publisher'));
    assert.equal((await Repo.siteInstallation.methods.findSelected())?.gatewayPublishedReleaseIds?.length, 2);
    await assert.rejects(() => publishGatewayRelease(source, 'partial-publisher', second.releaseId, randomUUID(), config, fetcher,
        () => ({ ...build(images[3]._id)(), pages: [{ path: '/', content: {
            image: `http://cms.invalid/api/v4/media/${images[3]._id}/bin/image.png`,
            missingImage: `http://cms.invalid/api/v4/media/${randomUUID()}/bin/image.png`,
        } }] } as unknown as ReleaseSnapshot)), MediaRetentionError);
    const partialIntent = JSON.parse((await source.findSite())!.gatewayPublishIntent!);
    assert.equal(partialIntent.status, 'failed');
    assert.equal(await source.findRelease(partialIntent.releaseId), null, 'failed preparation inserts no orphan Release');
    assert.equal((await publicImage(images[3]._id)).statusCode, 404);
    await claimMediaDeletion([images[3]._id]);
});
