import assert from 'node:assert/strict';
import test from 'node:test';
import * as preview from '../src/util/template-preview.ts';

const config = { templateOrigin: 'https://template.example.com', legacyOrigin: 'http://localhost:3000' };
const content = (version = '1.0.3', id = 'aeroframe') => ({ kind: 'preset-page', preset: { id, version }, view: 'product', sections: ['information'], seo: { title: 'Saved', description: '' } });
const snapshot = () => ({ kind: 'preset-site', siteName: 'CMS', schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', language: 'en', pages: [{ path: '/aircraft', pageKey: 'product', entryId: 'entry', content: { ...content(), items: [{ label: 'Related', path: '/aircraft' }] } }], navigation: [], redirects: [] });

test('renderer selection requires the explicitly supported identity/version and configured template origin', () => {
  assert.equal(typeof preview.resolvePreviewTarget, 'function');
  assert.equal(preview.resolvePreviewTarget(snapshot(), config).mode, 'template');
  assert.equal(preview.resolvePreviewTarget(content(), config).origin, 'https://template.example.com');
  for (const templateOrigin of ['', 'https://template.example.com/path', 'javascript:alert(1)']) assert.equal(preview.resolvePreviewTarget(content(), { ...config, templateOrigin }).mode, 'unsupported');
  for (const value of [content('1.0.1'), content('1.0.2'), content('1.0.3', 'other')]) assert.equal(preview.resolvePreviewTarget(value, config).mode, 'unsupported');
  const mixed = snapshot(); mixed.pages.push({ ...mixed.pages[0], content: content('1.0.2') });
  assert.equal(preview.resolvePreviewTarget(mixed, config).mode, 'unsupported');
});

test('legacy built-in templates retain their existing display preview with honest capability notice', () => {
  assert.equal(typeof preview.resolvePreviewTarget, 'function');
  for (const id of ['aeroframe', 'market', 'atelier']) {
    const target = preview.resolvePreviewTarget(content('1.0.0', id), config);
    assert.equal(target.mode, 'legacy'); assert.equal(target.origin, 'http://localhost:3000');
    assert.ok(target.notice.includes('内容检查'));
  }
});

test('ready handshake only accepts the chosen origin and actual iframe source', () => {
  assert.equal(typeof preview.isPreviewReady, 'function');
  const child = {}; const target = { contentWindow: child };
  const event = { origin: config.templateOrigin, source: child, data: { type: 'storefront:preview-ready' } };
  assert.equal(preview.isPreviewReady(event, target, config.templateOrigin), true);
  assert.equal(preview.isPreviewReady({ ...event, source: {} }, target, config.templateOrigin), false);
  assert.equal(preview.isPreviewReady({ ...event, origin: 'https://attacker.test' }, target, config.templateOrigin), false);
  assert.equal(preview.isPreviewReady({ ...event, data: { type: 'other' } }, target, config.templateOrigin), false);
});

test('unsaved single page overlays the saved snapshot without losing cards or mutating source', () => {
  assert.equal(typeof preview.overlayPagePreview, 'function');
  const saved = snapshot(); const page = content(); page.seo.title = 'Unsaved';
  const result = preview.overlayPagePreview(saved, page, { pageKey: 'product', entryId: 'entry', language: 'en', settings: false });
  assert.equal(result.path, '/aircraft'); assert.equal(result.payload.kind, 'preset-site');
  assert.equal(result.payload.pages[0].content.seo.title, 'Unsaved');
  assert.deepEqual(result.payload.pages[0].content.items, [{ label: 'Related', path: '/aircraft' }]);
  assert.equal(saved.pages[0].content.seo.title, 'Saved');
  assert.throws(() => preview.overlayPagePreview(saved, page, { pageKey: 'product', entryId: 'new-entry', language: 'en', settings: false }));
  assert.throws(() => preview.overlayPagePreview(saved, page, { pageKey: 'product', entryId: 'entry', language: 'zh', settings: false }));
});

test('template handshake verifies the renderer version instead of trusting any ready message', () => {
  const child = {}; const frame = { contentWindow: child };
  const event = { origin: config.templateOrigin, source: child, data: { type: 'storefront:preview-ready' } };
  assert.equal(preview.isPreviewReady(event, frame, config.templateOrigin, true), false);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'aeroframe', templateVersion: '1.0.2' } }, frame, config.templateOrigin, true), false);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'aeroframe', templateVersion: '1.0.3' } }, frame, config.templateOrigin, true), true);
});

test('delivery sends selected snapshot path to exact origin without retaining Vue proxies', () => {
  const messages = [];
  preview.sendRendererPreview({ contentWindow: { postMessage(value, origin) { messages.push([structuredClone(value), origin]); } } }, config.templateOrigin, snapshot(), '/aircraft');
  assert.equal(messages[0][0].type, 'storefront:preview');
  assert.equal(messages[0][0].path, '/aircraft'); assert.equal(messages[0][1], 'https://template.example.com');
});
