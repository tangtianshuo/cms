import assert from 'node:assert/strict';
import test from 'node:test';
import { isSiteDraftPreviewPayload } from '../app/utils/preview.mjs';

const page = {
    path: '/', pageKey: 'home', entryId: 'home-entry',
    content: {
        kind: 'preset-page', view: 'home', sections: ['hero', 'feature'], seo: { title: 'Home', description: '' },
        preset: { id: 'market', version: '1.0.0', name: 'Store', description: '',
            theme: { background: '#fff', foreground: '#111', accent: '#c33', muted: '#eee', font: 'Arial' },
            demo: { brand: 'Store', hero: { title: 'Hello', subtitle: '', image: '' }, collection: { title: '', description: '', image: '' }, product: { title: '', price: '', description: '', image: '' }, page: { title: '', body: '', image: '' } } },
    },
};

test('preview validates disabled navigation node shape while skipping only its link target', () => {
    const base = { kind: 'preset-site', schemaVersion: 1, siteId: 'site', siteName: 'Store', language: 'en', pages: [page], redirects: [] };
    assert.equal(isSiteDraftPreviewPayload({ ...base, navigation: [{ label: 'Disabled', href: '/missing', enabled: false, children: [] }] }), true);
    assert.equal(isSiteDraftPreviewPayload({ ...base, navigation: [{ label: 'Disabled', enabled: false, children: 'bad' }] }), false);
    assert.equal(isSiteDraftPreviewPayload({ ...base, navigation: [{ label: 'Disabled', enabled: false, children: [{}] }] }), false);
});
