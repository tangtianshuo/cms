import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import { resolvePreviewTarget, sendRendererPreview } from '../src/util/template-preview.ts';

const visualEditor = fs.readFileSync(new URL('../src/components/studio/visual-page-editor.tsx', import.meta.url), 'utf8');
const draftPreview = fs.readFileSync(new URL('../../storefront/app/pages/preview.vue', import.meta.url), 'utf8');
const studioCss = postcss.parse(fs.readFileSync(new URL('../src/components/studio/studio.css', import.meta.url), 'utf8'));

function declarations(selector, media = '') {
    const values = {};
    studioCss.walkRules(rule => {
        if (rule.selector !== selector) return;
        const parent = rule.parent;
        const inRequestedMedia = media
            ? parent?.type === 'atrule' && parent.name === 'media' && parent.params === media
            : !(parent?.type === 'atrule' && parent.name === 'media');
        if (!inRequestedMedia) return;
        rule.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
    });
    return values;
}

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

test('visual page workspace gives the canvas priority over side panels', () => {
    assert.equal(declarations('.studio-page-workspace')['max-width'], 'none');
    const editor = declarations('.studio-visual-page-editor');
    assert.equal(editor['grid-template-columns'], 'minmax(200px, 220px) minmax(440px, 1fr) minmax(220px, 260px)');
    assert.match(editor['--studio-visual-editor-height'], /max\(640px, calc\(100dvh - 260px\)\)/);
    assert.equal(editor['min-height'], 'var(--studio-visual-editor-height)');
});

test('mobile visual editor places the canvas before both side panels', () => {
    const editor = declarations('.studio-visual-page-editor', '(max-width: 767px)');
    assert.equal(editor['grid-template-areas'], '"preview" "blocks" "properties"');
});
