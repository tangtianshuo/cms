import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchProductPage } from '../server/utils/catalog.mjs';

const page = { product: { name: 'Studio Headphones' } };

test('fetches the configured development site and returns its product', async () => {
    const result = await fetchProductPage({
        slug: 'studio-headphones',
        host: 'localhost:3000',
        expectedHost: 'localhost:3000',
        cmsOrigin: 'http://localhost:8080',
        fetcher: async (url, options) => {
            assert.equal(url, 'http://localhost:8080/api/v4/storefront/products/studio-headphones');
            assert.equal(options.headers['x-storefront-host'], 'localhost:3000');
            return page;
        },
    });
    assert.equal(result?.product.name, 'Studio Headphones');
});

test('unknown host and CMS 404 produce a missing page', async () => {
    const settings = {
        slug: 'missing',
        host: 'other.test',
        expectedHost: 'localhost:3000',
        cmsOrigin: 'http://localhost:8080',
        fetcher: async () => page,
    };
    assert.equal(await fetchProductPage(settings), null);
    assert.equal(await fetchProductPage({
        ...settings,
        host: 'localhost:3000',
        fetcher: async () => { throw { statusCode: 404 }; },
    }), null);
});

test('CMS failures other than 404 remain errors', async () => {
    await assert.rejects(() => fetchProductPage({
        slug: 'product',
        host: 'localhost:3000',
        expectedHost: 'localhost:3000',
        cmsOrigin: 'http://localhost:8080',
        fetcher: async () => { throw { statusCode: 503 }; },
    }));
});
