import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntimePublishedPage } from '../server/utils/runtime-page.mjs';

const release = {
    releaseId: 'release-1',
    snapshot: {
        origin: 'https://shop.test',
        primaryHostname: 'shop.test',
        bindingRevision: 7,
        language: 'en',
        pages: [
            { path: '/', pageKey: 'home', content: { kind: 'preset-page', view: 'home' } },
            { path: '/about', pageKey: 'about', content: { kind: 'preset-page', view: 'page' } },
        ],
        navigation: [{ id: 'home', label: 'Home', href: '/', enabled: true }],
        redirects: [{ from: '/old-about', to: '/about' }],
    },
};

test('resolves a published page from the runtime snapshot', () => {
    assert.deepEqual(resolveRuntimePublishedPage(release, '/about'), {
        origin: 'https://shop.test',
        primaryHostname: 'shop.test',
        bindingRevision: 7,
        releaseId: 'release-1',
        language: 'en',
        path: '/about',
        content: { kind: 'preset-page', view: 'page' },
        navigation: [{ id: 'home', label: 'Home', href: '/', enabled: true }],
    });
});

test('resolves redirects and reports unknown paths as missing', () => {
    assert.deepEqual(resolveRuntimePublishedPage(release, '/old-about'), {
        origin: 'https://shop.test',
        primaryHostname: 'shop.test',
        bindingRevision: 7,
        releaseId: 'release-1',
        language: 'en',
        path: '/old-about',
        redirect: '/about',
        navigation: [{ id: 'home', label: 'Home', href: '/', enabled: true }],
    });
    assert.equal(resolveRuntimePublishedPage(release, '/missing'), null);
});

test('rejects unsafe runtime paths', () => {
    assert.throws(() => resolveRuntimePublishedPage(release, '//evil.test'), /Invalid published path/);
    assert.throws(() => resolveRuntimePublishedPage(release, '/%2f%2fevil.test'), /Invalid published path/);
});
