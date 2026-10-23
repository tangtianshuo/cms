import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePreviewPages, buildPagePreviewRequest } from '../src/util/page-preview.ts';

const site = {
    status: 'ready',
    models: [
        { key: 'home', templateId: 'home-model' },
        { key: 'content-page', templateId: 'content-model' },
        { key: 'site-settings', templateId: 'settings-model' },
    ],
    pages: [
        { key: 'home', title: 'Home', modelKey: 'home' },
        { key: 'content', title: 'Content', modelKey: 'content-page' },
    ],
};

test('preview choices are limited to pages served by the generated model', () => {
    assert.deepEqual(availablePreviewPages(site, 'home-model').map((page) => page.key), ['home']);
    assert.deepEqual(availablePreviewPages(site, 'content-model').map((page) => page.key), ['content']);
    assert.deepEqual(availablePreviewPages(site, 'settings-model').map((page) => page.key), ['home', 'content']);
    assert.deepEqual(availablePreviewPages(site, 'unrelated'), []);
});

test('preview request carries the unsaved Entry, selected page and language', () => {
    const entry = { templateId: 'content-model', meta: [{ lng: 'en', props: [{ id: 'title', data: ['New title'] }] }] };
    assert.deepEqual(buildPagePreviewRequest(site, entry, 'content', 'en'), {
        entry, pageKey: 'content', language: 'en',
    });
    assert.throws(() => buildPagePreviewRequest(site, entry, 'home', 'en'), /page/i);
});
