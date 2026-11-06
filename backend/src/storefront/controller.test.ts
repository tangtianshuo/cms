import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { getProductPage, previewProductPage } from './service';
import { StorefrontController } from './controller';

const template = {
    _id: 'product-template',
    name: 'product',
    props: [
        { id: 'title', name: 'title', type: 'STRING', array: false },
        { id: 'slug', name: 'slug', type: 'STRING', array: false },
        { id: 'price', name: 'price', type: 'NUMBER', array: false },
        { id: 'description', name: 'description', type: 'STRING', array: false },
        { id: 'images', name: 'images', type: 'MEDIA', array: true },
    ],
} as Template;

const saved = {
    templateId: 'product-template',
    meta: [{
        lng: 'en',
        props: [
            { id: 'title', data: ['Saved title'] },
            { id: 'slug', data: ['saved-product'] },
            { id: 'price', data: [35] },
            { id: 'description', data: ['Saved description'] },
            { id: 'images', data: [] },
        ],
    }],
} as Entry;

const site = {
    name: 'Example Store',
    host: 'localhost:3000',
    language: 'en',
    currency: 'USD',
    mediaOrigin: 'http://localhost:8080',
};

test('public lookup returns saved data only for the configured host and slug', async () => {
    const sources = {
        findTemplate: async () => template,
        findEntries: async () => [saved],
        findMedia: async () => [],
    };
    const found = await getProductPage('saved-product', 'localhost:3000', site, sources);
    assert.equal(found?.product.name, 'Saved title');
    assert.equal(found?.site.name, 'Example Store');
    assert.equal(await getProductPage('unknown', 'localhost:3000', site, sources), null);
    assert.equal(await getProductPage('saved-product', 'other.test', site, sources), null);
});

test('demo entries from a preset import stay off the public product route', async () => {
    const source = {
        findTemplate: async () => template,
        findEntries: async () => [{ ...saved, userId: '__preset' }],
        findMedia: async () => [],
    };
    assert.equal(await getProductPage('saved-product', 'localhost:3000', site, source), null);
});

test('preview maps unsaved entry without mutating the saved entry', async () => {
    const draft = structuredClone(saved);
    (draft.meta[0].props[0].data as string[])[0] = 'Unsaved title';
    const result = await previewProductPage(draft, site, template, []);
    assert.equal(result.product.name, 'Unsaved title');
    assert.equal((saved.meta[0].props[0].data as string[])[0], 'Saved title');
    await assert.rejects(() => previewProductPage({ ...draft, templateId: 'other' }, site, template, []));
});

test('preview endpoint rejects requests without a CMS access token', async () => {
    const controller = await StorefrontController({} as never);
    const methods = await controller.methods(controller);
    for (const name of ['preview', 'pagePreview']) {
        const preview = methods.find((method) => method.name === name);
        assert.ok(preview);
        await assert.rejects(
            () => preview.handler({ headers: {}, query: {}, body: { entry: saved } } as never, {} as never),
            (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
        );
    }
});

test('preview runtime endpoint rejects unauthenticated access', async () => {
    const controller = await StorefrontController({} as never);
    const runtime = (await controller.methods(controller)).find(method => method.name === 'previewRuntime')!;
    assert.ok(runtime);
    await assert.rejects(runtime.handler({ headers: {}, query: {} } as never, {} as never),
        (error: unknown) => (error as { status?: number })?.status === 403);
});

test('preview runtime endpoint uses the authorized installation and keeps unavailable states safe and distinct', async (t) => {
    const { RP } = await import('../security/route-protection/main');
    const { Repo } = await import('../repo');
    const { Config } = await import('../config');
    const { verifiedWorkspace, workspaceContext } = await import('../workspaces/context');
    const context = { workspaceId: 'workspace-a', siteId: 'site-a', actorId: 'user-a', admin: true,
        instanceAdmin: true, role: 'admin' as const };
    // Authentication is exercised above; this test fixes the verified principal at the auth boundary.
    t.mock.method(RP, 'createJwtCheck', () => async () => ({ [verifiedWorkspace]: context }));
    const installation = { status: 'ready', presetId: 'aeroframe', presetVersion: '1.0.4' };
    const previousMethods = Object.getOwnPropertyDescriptor(Repo.siteInstallation, 'methods')!;
    Object.defineProperty(Repo.siteInstallation, 'methods', { configurable: true, value: { findSelected: async () => {
        assert.equal(workspaceContext()?.workspaceId, 'workspace-a');
        assert.equal(workspaceContext()?.siteId, 'site-a');
        return installation as never;
    } } });
    const previousService = Config.storefrontPreviewServiceUrl;
    Object.defineProperty(Config, 'storefrontPreviewServiceUrl', { value: 'https://private.preview.invalid', configurable: true });
    const controller = await StorefrontController({} as never);
    const runtime = (await controller.methods(controller)).find(method => method.name === 'previewRuntime')!;
    const headers: Record<string, string> = {};
    const reply = { header: (key: string, value: string) => { headers[key] = value; } };
    const request = (query: Record<string, string> = { templateId: 'aeroframe', templateVersion: '1.0.4' }) =>
        runtime.handler({ headers: {}, query } as never, reply as never);
    let calls = 0;
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 404 }); });
    try {
        await assert.rejects(request({ templateId: 'fireguard', templateVersion: '1.0.1' }),
            (error: unknown) => (error as { status?: number })?.status === 400);
        assert.equal(calls, 0);
        assert.deepEqual(JSON.parse(await request()), { status: 'unavailable', configured: true, runtime: null,
            templateId: 'aeroframe', templateVersion: '1.0.4' });
        assert.equal(headers['Cache-Control'], 'no-store');
        fetchMock.mock.mockImplementation(async () => { throw new Error('https://private.preview.invalid?secret=credential'); });
        await assert.rejects(request(), (error: unknown) => {
            const details = error as { status: number; message: { message: string } };
            assert.equal(details.status, 503);
            assert.deepEqual(details.message, { message: '预览服务暂时不可用，可重试' });
            return true;
        });
        const descriptor = { templateId: 'aeroframe', templateVersion: '1.0.4', protocolVersion: 1,
            digest: `sha256:${'e'.repeat(64)}`, url: 'https://private.preview.invalid/preview/aeroframe/1.0.4/' };
        fetchMock.mock.mockImplementation(async () => Response.json(descriptor));
        assert.deepEqual(JSON.parse(await request()), { status: 'ready', configured: true, runtime: descriptor });
        Object.defineProperty(Config, 'storefrontPreviewServiceUrl', { value: '', configurable: true });
        assert.deepEqual(JSON.parse(await request()), { status: 'legacy', configured: false, runtime: null });
    } finally {
        Object.defineProperty(Repo.siteInstallation, 'methods', previousMethods);
        Object.defineProperty(Config, 'storefrontPreviewServiceUrl', { value: previousService, configurable: true });
    }
});
