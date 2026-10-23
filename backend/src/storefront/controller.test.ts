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
