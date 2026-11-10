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
  assert.equal(preview.resolvePreviewTarget(content(), { ...config, templateOrigin: '' }).mode, 'unsupported');
  for (const templateOrigin of ['https://template.example.com/path', 'javascript:alert(1)']) assert.equal(preview.resolvePreviewTarget(content(), { ...config, templateOrigin }).mode, 'config-error');
  for (const value of [content('1.0.1'), content('1.0.2'), content('1.0.3', 'other')]) assert.equal(preview.resolvePreviewTarget(value, config).mode, 'unsupported');
  const mixed = snapshot(); mixed.pages.push({ ...mixed.pages[0], content: content('1.0.2') });
  assert.equal(preview.resolvePreviewTarget(mixed, config).mode, 'unsupported');
});

test('exact renderer map supports FireGuard and invalid mappings fail closed', () => {
  const fireguard = { kind: 'preset-page', preset: { id: 'fireguard', version: '1.0.0' }, view: 'home', sections: [], seo: { title: '', description: '' } };
  const renderers = JSON.stringify({
    'fireguard@1.0.0': 'https://fireguard-preview.example.com',
    'aeroframe@1.0.3': 'https://aeroframe-preview.example.com',
  });
  const target = preview.resolvePreviewTarget(fireguard, { renderers });
  assert.equal(target.mode, 'template');
  assert.equal(target.origin, 'https://fireguard-preview.example.com');
  assert.equal(target.templateId, 'fireguard');
  assert.equal(target.templateVersion, '1.0.0');
  assert.equal(preview.resolvePreviewTarget(fireguard, { renderers: '{' }).mode, 'config-error');
  assert.equal(preview.resolvePreviewTarget(fireguard, { renderers: JSON.stringify({ 'fireguard@1.0.0': 'https://preview.example.com/path' }) }).mode, 'config-error');
  assert.equal(preview.resolvePreviewTarget(fireguard, { renderers: JSON.stringify({ 'fireguard': 'https://preview.example.com' }) }).mode, 'config-error');
});

test('unified preview runtime selects a versioned service URL and rejects identity drift', () => {
  const fireguard = { kind: 'preset-page', preset: { id: 'fireguard', version: '1.0.0' }, view: 'home', sections: [], seo: { title: '', description: '' } };
  const runtime = {
    templateId: 'fireguard', templateVersion: '1.0.0', protocolVersion: 1,
    digest: `sha256:${'a'.repeat(64)}`,
    url: 'https://preview.example.com/preview/fireguard/1.0.0/',
  };
  const target = preview.resolvePreviewTarget(fireguard, config, runtime);
  assert.equal(target.mode, 'template');
  assert.equal(target.url, runtime.url);
  assert.equal(target.origin, 'https://preview.example.com');
  assert.equal(target.digest, runtime.digest);
  assert.equal(preview.resolvePreviewTarget(fireguard, config, { ...runtime, templateVersion: '1.0.1' }).mode, 'config-error');
});

test('loads the unified renderer descriptor through the authenticated CMS endpoint', async () => {
  const payload = content('1.0.0', 'fireguard');
  const runtime = {
    templateId: 'fireguard', templateVersion: '1.0.0', protocolVersion: 1,
    digest: `sha256:${'b'.repeat(64)}`,
    url: 'https://preview.example.com/preview/fireguard/1.0.0/',
  };
  const result = await preview.loadPreviewRuntime(payload, async url => {
    assert.equal(url, '/api/v4/storefront/preview-runtime?templateId=fireguard&templateVersion=1.0.0');
    return { configured: true, runtime };
  });
  assert.deepEqual(result, runtime);
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
  assert.equal(preview.isPreviewReady(event, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), false);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'aeroframe', templateVersion: '1.0.2' } }, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), false);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'aeroframe', templateVersion: '1.0.3' } }, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), true);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'fireguard', templateVersion: '1.0.0' } }, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), false);
});

test('delivery sends selected snapshot path to exact origin without retaining Vue proxies', () => {
  const messages = [];
  preview.sendRendererPreview({ contentWindow: { postMessage(value, origin) { messages.push([structuredClone(value), origin]); } } }, config.templateOrigin, snapshot(), '/aircraft');
  assert.equal(messages[0][0].type, 'storefront:preview');
  assert.equal(messages[0][0].path, '/aircraft'); assert.equal(messages[0][1], 'https://template.example.com');
});
