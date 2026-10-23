import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublishedSite, sitemapXml } from '../server/utils/release.mjs';

test('public page lookup encodes the exact route and supplies only the validated host', async () => {
    let called = false;
    const options = { host: 'shop.test', expectedHost: 'shop.test', cmsOrigin: 'http://cms.test/',
        path: '/pages/about', fetcher: async (url, request) => {
            called = true;
            assert.equal(url, 'http://cms.test/api/v4/storefront/published?path=%2Fpages%2Fabout');
            assert.deepEqual(request.headers, { 'x-storefront-host': 'shop.test' });
            return { releaseId: 'release', path: '/pages/about' };
        } };
    assert.equal(await fetchPublishedSite({ ...options, host: 'attacker.test' }), null);
    assert.equal(called, false);
    assert.equal((await fetchPublishedSite(options)).releaseId, 'release');
    assert.equal(await fetchPublishedSite({ ...options, fetcher: async () => { throw { statusCode: 404 }; } }), null);
    await assert.rejects(() => fetchPublishedSite({ ...options, fetcher: async () => { throw { statusCode: 503 }; } }));
});

test('sitemap lists concrete release paths with XML escaping', () => {
    const xml = sitemapXml(['/', '/pages/about'], 'https://shop.test');
    assert.ok(xml.includes('<loc>https://shop.test/pages/about</loc>'));
    assert.ok(xml.includes('<loc>https://shop.test/</loc>'));
    assert.equal(xml.includes(':slug'), false);
    assert.ok(sitemapXml(['/page?a=1&b=2'], 'https://shop.test').includes('&amp;'));
});

test('custom host calls carry internal credentials and reject unsafe redirect paths', async () => {
    const { trustedGatewayHost, aliasRedirect } = await import('../server/utils/release.mjs');
    assert.equal(trustedGatewayHost({ host: 'shop.test', forwardedHost: 'evil.test', key: '', secret: 'secret', expectedHost: 'localhost:3000', production: true }), null);
    assert.equal(trustedGatewayHost({ host: 'SHOP.test', forwardedHost: 'alias.test', key: 'secret', secret: 'secret', production: true }), null);
    assert.equal(trustedGatewayHost({ host: 'shop.test', forwardedHost: 'shop.test', key: 'secret', secret: 'secret', production: true }), 'shop.test');
    assert.equal(trustedGatewayHost({ host: 'localhost:3000', expectedHost: 'localhost:3000', production: false }), 'localhost:3000');
    const result = await fetchPublishedSite({ host: 'alias.test', gatewaySecret: 'secret', cmsOrigin: 'http://cms.test', path: '/', fetcher: async (_url, options) => ({ hostname: options.headers['x-storefront-host'], key: options.headers['x-storefront-key'] }) });
    assert.deepEqual(result, { hostname: 'alias.test', key: 'secret' });
    assert.equal(aliasRedirect('alias.test', 'shop.test', '/a?x=1'), 'https://shop.test/a?x=1');
    assert.equal(aliasRedirect('shop.test', 'shop.test', '/a'), null);
    for (const path of ['//evil.test/a', '/\\evil.test/a', '/%2fevil.test', '/a\r\nLocation: x']) assert.equal(aliasRedirect('alias.test', 'shop.test', path), null);
});
