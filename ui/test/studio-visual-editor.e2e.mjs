import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import { chromium } from 'playwright';
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

test('content workspace gives the canvas priority over side panels', () => {
    const editor = declarations('.studio-visual-page-editor');
    assert.equal(editor['grid-template-columns'], 'minmax(180px, 200px) minmax(480px, 1fr) minmax(220px, 240px)');
    assert.match(editor['--studio-visual-editor-height'], /max\(640px, calc\(100dvh - 260px\)\)/);
    assert.equal(editor['min-height'], 'var(--studio-visual-editor-height)');
    assert.equal(declarations('.studio-content-workspace .studio-visual-page-editor')['grid-template-columns'],
        'minmax(180px, 200px) minmax(480px, 1fr) minmax(220px, 240px)');
    assert.equal(declarations('.studio-page-workspace')['max-width'], 'none');
});

test('mobile visual editor places the canvas before both side panels', () => {
    const editor = declarations('.studio-content-workspace .studio-visual-page-editor', '(max-width: 767px)');
    assert.equal(editor['grid-template-areas'], '"preview" "blocks" "properties"');
});

test('real page workspace uses available width and preserves a usable canvas', async t => {
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<style>
      :root{--cms-primary:#2563eb;--cms-ink:#182230;--cms-muted:#5c697c;--cms-border:#e3e8ef;--cms-control-border:#bdc8d6;--cms-canvas:#f7f9fc;--cms-surface:#fff;--cms-hover:#f0f4fa}
      *{box-sizing:border-box} body{margin:0;background:#f7f9fc;font-family:Arial,sans-serif}
      ${fs.readFileSync(new URL('../src/components/studio/studio.css', import.meta.url), 'utf8')}
    </style>
    <div class="cms-studio"><div class="layout-viewport"><form id="studio-page-form" class="studio-card studio-editor studio-page-workspace">
      <div class="studio-visual-page-editor">
        <aside class="studio-visual-sidebar studio-visual-sidebar--left"><strong>页面区块</strong></aside>
        <div class="studio-visual-preview">页面画布</div>
        <aside class="studio-visual-sidebar studio-visual-sidebar--right"><strong>属性与 SEO</strong></aside>
      </div>
    </form></div></div>`);

    const measure = async (width, contentWidth, padding) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(({ contentWidth, padding }) => {
            const viewport = document.querySelector('.layout-viewport');
            viewport.style.width = `${contentWidth}px`;
            viewport.style.padding = `32px ${padding}px`;
        }, { contentWidth, padding });
        return page.evaluate(() => {
            const box = selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return { width: rect.width, top: rect.top };
            };
            return {
                form: box('#studio-page-form'),
                preview: box('.studio-visual-preview'),
                left: box('.studio-visual-sidebar--left'),
            };
        });
    };

    const desktop = await measure(1440, 1128, 36);
    assert.ok(desktop.form.width >= 1054, `desktop form remains capped at ${desktop.form.width}px`);
    assert.ok(desktop.preview.width >= 560, `desktop canvas is only ${desktop.preview.width}px`);

    const laptop = await measure(1280, 992, 24);
    assert.ok(laptop.form.width >= 940, `laptop form remains capped at ${laptop.form.width}px`);
    assert.ok(laptop.preview.width >= 480, `laptop canvas is only ${laptop.preview.width}px`);

    const tablet = await measure(1024, 736, 24);
    assert.ok(tablet.preview.width >= 450, `tablet canvas is only ${tablet.preview.width}px`);

    const mobile = await measure(390, 358, 16);
    assert.ok(mobile.preview.width >= 288, `mobile canvas is only ${mobile.preview.width}px`);
    assert.ok(mobile.preview.top < mobile.left.top, 'mobile canvas must precede the block tree');
});
