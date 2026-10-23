import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPresetDemo, presetView } from '../server/utils/preset.mjs';

test('demo lookup fetches the selected platform preset', async () => {
    const data = { id: 'atelier', name: 'Atelier' };
    const calls = [];
    const found = await fetchPresetDemo({
        id: 'atelier', cmsOrigin: 'http://cms.internal:8080',
        fetcher: async (url) => { calls.push(url); return data; },
    });
    assert.equal(found, data);
    assert.deepEqual(calls, ['http://cms.internal:8080/api/v4/presets/catalog/atelier']);
});

test('demo lookup treats unknown presets as missing but surfaces backend failures', async () => {
    assert.equal(await fetchPresetDemo({ id: 'missing', cmsOrigin: 'http://cms', fetcher: async () => {
        throw { statusCode: 404 };
    } }), null);
    await assert.rejects(fetchPresetDemo({ id: 'atelier', cmsOrigin: 'http://cms', fetcher: async () => {
        throw new Error('offline');
    } }), /offline/);
});

test('only supported page views can be shown in a demo', () => {
    assert.equal(presetView(undefined), 'home');
    assert.equal(presetView('collection'), 'collection');
    assert.equal(presetView('product'), 'product');
    assert.equal(presetView('page'), 'page');
    assert.equal(presetView('checkout'), null);
});
