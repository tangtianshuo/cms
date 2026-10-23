import assert from 'node:assert/strict';
import test from 'node:test';
import { isPresetPreviewPayload } from '../app/utils/preview.mjs';

const payload = {
    kind: 'preset-page', view: 'home', sections: ['hero', 'feature'],
    seo: { title: 'Home', description: '' },
    preset: {
        id: 'market', version: '1.0.0', name: 'Store', description: '',
        theme: { background: '#fff', foreground: '#111', accent: '#c33', muted: '#eee', font: 'Arial' },
        demo: {
            brand: 'Store', hero: { title: 'Hello', subtitle: '', image: '' },
            collection: { title: '', description: '', image: '' },
            product: { title: '', price: '', description: '', image: '' },
            page: { title: '', body: '', image: '' },
        },
    },
};

test('preview accepts a complete preset page payload', () => {
    assert.equal(isPresetPreviewPayload(payload), true);
});

test('preview rejects unknown layouts and incomplete nested data', () => {
    assert.equal(isPresetPreviewPayload({ ...payload, view: 'checkout' }), false);
    assert.equal(isPresetPreviewPayload({ ...payload, preset: { ...payload.preset, demo: null } }), false);
    assert.equal(isPresetPreviewPayload({ ...payload, sections: ['hero', 1] }), false);
});
