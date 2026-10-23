import assert from 'node:assert/strict';
import test from 'node:test';
import { getPreset, listPresets } from './catalog';

test('catalog exposes two complete storefront variants', () => {
    const list = listPresets();
    assert.equal(list.length, 2);
    assert.notEqual(list[0].id, list[1].id);
    for (const item of list) {
        assert.ok(item.heroImage.startsWith('https://'));
        const preset = getPreset(item.id, item.version);
        assert.ok(preset);
        assert.deepEqual(preset.models.map((model) => model.key), [
            'product', 'collection', 'home', 'content-page', 'site-settings',
        ]);
        assert.deepEqual(preset.pages.map((page) => page.path), [
            '/', '/collections', '/products/:slug', '/pages/:slug',
        ]);
        for (const model of preset.models) {
            assert.deepEqual(model.fields.slice(0, 2).map((field) => field.key), ['title', 'slug']);
            assert.equal(new Set(model.fields.map((field) => field.key)).size, model.fields.length);
        }
        assert.ok(preset.demo.product.image.startsWith('https://'));
    }
});

test('catalog rejects unknown versions and cannot be changed by consumers', () => {
    assert.equal(getPreset('missing'), null);
    assert.equal(getPreset('atelier', '2.0.0'), null);
    const preset = getPreset('atelier');
    assert.ok(preset);
    assert.throws(() => { preset.models[0].fields[0].label = 'Changed'; }, TypeError);
    assert.equal(getPreset('atelier')?.models[0].fields[0].label, 'Title');
});
