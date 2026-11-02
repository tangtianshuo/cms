import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolvePreviewTarget, sendRendererPreview } from '../src/util/template-preview.ts';

const visualEditor = fs.readFileSync(new URL('../src/components/studio/visual-page-editor.tsx', import.meta.url), 'utf8');
const draftPreview = fs.readFileSync(new URL('../../storefront/app/pages/preview.vue', import.meta.url), 'utf8');

test('visual editor and storefront preview share the guarded node selection protocol', () => {
    for (const token of ['studio:select-node', 'studio:node-selected', 'event.origin', 'event.source', 'templateId', 'templateVersion']) {
        assert.ok(visualEditor.includes(token), `visual editor must contain ${token}`);
    }
    for (const token of ['studio:select-node', 'event.source !== window.parent', 'event.origin !== new URL(config.public.adminOrigin).origin', 'studio:node-selected']) {
        assert.ok(draftPreview.includes(token), `storefront preview must contain ${token}`);
    }
});

test('preview delivery preserves the selected path and exact renderer origin', () => {
    const payload = { kind: 'preset-site', pages: [] };
    const target = resolvePreviewTarget({ kind: 'preset-page', preset: { id: 'aeroframe', version: '1.0.3' } }, { templateOrigin: 'https://renderer.example.com' });
    assert.equal(target.mode, 'template');
    const messages = [];
    sendRendererPreview({ contentWindow: { postMessage: (...args) => messages.push(args) } }, target.origin, payload, '/about');
    assert.deepEqual(messages, [[{ type: 'storefront:preview', payload, path: '/about' }, 'https://renderer.example.com']]);
});
