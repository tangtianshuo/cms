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
