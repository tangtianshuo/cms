import assert from 'node:assert/strict';
import test from 'node:test';

// Run only against a disposable CMS database with a seeded test administrator.
test('rebuilt deployment: publish, saved-content isolation, add, rename, retire and rollback', {
    skip: !process.env.STOREFRONT_E2E_CMS,
    timeout: 60000,
}, async () => {
    const cms = process.env.STOREFRONT_E2E_CMS;
    const origin = process.env.STOREFRONT_E2E_ORIGIN;
    assert.ok(origin && process.env.STOREFRONT_E2E_EMAIL && process.env.STOREFRONT_E2E_PASSWORD);
    let token = '';
    async function request(path, body, method = body === undefined ? 'GET' : 'POST', status = 200) {
        const response = await fetch(`${cms}${path}`, { method,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body) });
        assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
        return response.json();
    }
    async function page(path, status = 200) {
        const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
        assert.equal(response.status, status, path);
        if (status === 200) assert.equal(response.headers.get('cache-control'), 'no-store');
        return response;
    }
    const login = await request('/api/v4/auth/login', { email: process.env.STOREFRONT_E2E_EMAIL,
        password: process.env.STOREFRONT_E2E_PASSWORD });
    token = login.accessToken;
    assert.ok(typeof token === 'string' && token.length);
    const history = await request('/api/v4/presets/releases/');
    assert.equal(history.items.length, 0, 'Use a fresh disposable database');
    const site = await request('/api/v4/presets/import', { presetId: 'atelier', siteName: 'Docker Phase C Store', includeDemo: true });
    await page('/', 404);
    assert.equal((await request('/api/v4/presets/releases/check', {})).valid, true);
    const first = await request('/api/v4/presets/releases/publish', { expectedReleaseId: '' });
    const original = await (await page('/')).text();
    assert.ok(original.includes('Docker Phase C Store'));
    await page('/products/featured-product');
    const homeModel = site.models.find(model => model.key === 'home');
    const homes = await request(`/api/v4/template/${homeModel.templateId}/entry/all`);
    const home = homes.items[0];
    const originalMeta = structuredClone(home.meta.find(meta => meta.lng === 'en'));
    const draftMeta = structuredClone(originalMeta);
    draftMeta.props.find(prop => prop.id === homeModel.fields.find(field => field.key === 'headline').propId).data = ['Docker saved draft headline'];
    await request(`/api/v4/template/${homeModel.templateId}/entry/update`, { _id: home._id, lng: 'en',
        meta: { props: draftMeta.props }, content: { nodes: home.content.find(content => content.lng === 'en')?.nodes || [] } }, 'PUT');
    assert.ok(!(await (await page('/')).text()).includes('Docker saved draft headline'));
    const model = site.models.find(model => model.key === 'content-page');
    const entries = await request(`/api/v4/template/${model.templateId}/entry/all`);
    const data = { title: 'Delivery', path: '/delivery', seoTitle: 'Docker delivery',
        seoDescription: 'Delivery acceptance', sections: ['story'], entryId: entries.items[0]._id,
        navigation: true, enabled: true };
    const created = await request('/api/v4/presets/pages', { ...data, blueprintKey: 'content' });
    await page('/delivery', 404);
    const check = await request('/api/v4/presets/releases/check', {});
    assert.equal(check.valid, true, JSON.stringify(check));
    assert.ok(check.diff.added.includes('/delivery'));
    const second = await request('/api/v4/presets/releases/publish', { expectedReleaseId: first.releaseId });
    assert.ok((await (await page('/')).text()).includes('Docker saved draft headline'));
    const delivery = await (await page('/delivery')).text();
    assert.ok(delivery.includes('<title>Docker delivery</title>'));
    assert.ok(delivery.includes('rel="canonical"'));
    assert.ok((await (await page('/sitemap.xml')).text()).includes('/delivery</loc>'));
    await request(`/api/v4/presets/pages/${created.key}`, { ...data, path: '/shipping' });
    const third = await request('/api/v4/presets/releases/publish', { expectedReleaseId: second.releaseId });
    assert.equal((await page('/delivery', 301)).headers.get('location'), '/shipping');
    await page('/shipping');
    await request(`/api/v4/presets/pages/${created.key}`, { ...data, path: '/shipping', enabled: false, navigation: false });
    const fourth = await request('/api/v4/presets/releases/publish', { expectedReleaseId: third.releaseId });
    await page('/shipping', 404);
    assert.ok(!(await (await page('/sitemap.xml')).text()).includes('/shipping</loc>'));
    await request('/api/v4/presets/releases/publish', { expectedReleaseId: third.releaseId }, 'POST', 400);
    await request('/api/v4/presets/releases/rollback', { releaseId: first.releaseId, expectedReleaseId: fourth.releaseId });
    assert.ok(!(await (await page('/')).text()).includes('Docker saved draft headline'));
    await page('/delivery', 404);
    await page('/shipping', 404);
    const records = await request('/api/v4/presets/releases/');
    assert.equal(records.currentReleaseId, first.releaseId);
    assert.equal(records.items.length, 4);
    assert.ok(records.audit.some(event => event.operation === 'rollback' && !event.error));
    const unauthorized = await fetch(`${cms}/api/v4/presets/releases/`);
    assert.equal(unauthorized.status, 403);
    const wrongHost = await fetch(`${cms}/api/v4/storefront/published?path=/`, { headers: { 'x-storefront-host': 'wrong.test' } });
    assert.equal(wrongHost.status, 404);
    await page('/unknown-draft', 404);
});
