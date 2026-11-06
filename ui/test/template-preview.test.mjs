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
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1 } }, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), true);
  assert.equal(preview.isPreviewReady({ ...event, data: { ...event.data, templateId: 'fireguard', templateVersion: '1.0.0' } }, frame, config.templateOrigin, { id: 'aeroframe', version: '1.0.3' }), false);
});

test('delivery sends selected snapshot path to exact origin without retaining Vue proxies', () => {
  const messages = [];
  preview.sendRendererPreview({ contentWindow: { postMessage(value, origin) { messages.push([structuredClone(value), origin]); } } }, config.templateOrigin, snapshot(), '/aircraft');
  assert.equal(messages[0][0].type, 'storefront:preview');
  assert.equal(messages[0][0].path, '/aircraft'); assert.equal(messages[0][1], 'https://template.example.com');
});

test('whole-site resolution checks the common installed identity and rejects mixed sites before requesting', async () => {
  const runtime = { templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1,
    digest: `sha256:${'c'.repeat(64)}`, url: 'https://preview.example/preview/aeroframe/1.0.3/' };
  let requests = 0;
  const request = async () => { requests++; return { status: 'ready', configured: true, runtime }; };
  assert.deepEqual(await preview.loadPreviewRuntime(snapshot(), request), runtime);
  assert.equal(requests, 1);
  const mixed = snapshot(); mixed.pages.push({ ...mixed.pages[0], content: content('1.0.2') });
  await assert.rejects(preview.loadPreviewRuntime(mixed, request));
  assert.equal(requests, 1);
});

test('a configured service missing the exact version never falls back to an available legacy map', async () => {
  await assert.rejects(preview.loadPreviewRuntime(content(), async () => ({
    status: 'unavailable', configured: true, runtime: null, templateId: 'aeroframe', templateVersion: '1.0.3',
  })), /该模板版本尚未提供预览/);
  assert.equal(await preview.loadPreviewRuntime(content(), async () => ({ status: 'legacy', configured: false, runtime: null })), null);
});

test('ready handshake requires protocol 1 and rejects an old site iframe on the same origin', () => {
  const oldChild = {}, newChild = {}, messages = [];
  const frame = { contentWindow: { postMessage: (...args) => messages.push(args) } };
  const expected = { id: 'aeroframe', version: '1.0.3' };
  const event = { origin: config.templateOrigin, source: oldChild, data: {
    type: 'storefront:preview-ready', templateId: expected.id, templateVersion: expected.version, protocolVersion: 1,
  } };
  frame.contentWindow = newChild;
  assert.equal(preview.isPreviewReady(event, frame, config.templateOrigin, expected), false);
  assert.equal(preview.isPreviewReady({ ...event, source: newChild, data: { ...event.data, protocolVersion: undefined } }, frame, config.templateOrigin, expected), false);
  assert.equal(preview.isPreviewReady({ ...event, source: newChild, data: { ...event.data, protocolVersion: 2 } }, frame, config.templateOrigin, expected), false);
  assert.equal(preview.isPreviewReady({ ...event, source: newChild }, frame, config.templateOrigin, expected), true);
  assert.deepEqual(messages, []);
});

test('switching the whole-site view clears its descriptor and rejects the previous iframe ready event', async () => {
  const { createServer } = await import('vite');
  const { default: vueJsx } = await import('@vitejs/plugin-vue-jsx');
  const { createRenderer, h, nextTick, ssrContextKey, markRaw, reactive } = await import('vue');
  const { createMemoryHistory, createRouter, RouterView } = await import('vue-router');
  const { createI18n } = await import('vue-i18n');
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    plugins: [vueJsx()], server: { middlewareMode: true },
    resolve: { alias: { '@bcms/selfhosted-ui': new URL('../src', import.meta.url).pathname } } });
  const originalWindow = globalThis.window;
  const listeners = new Map();
  const messages = [];
  let pendingSite;
  const runtime = { templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1,
    digest: `sha256:${'d'.repeat(64)}`, url: 'https://preview.example/preview/aeroframe/1.0.3/' };
  globalThis.window = { addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name), bcms: { sdk: {
      context: { site: { name: 'Site' }, workspace: { name: 'Workspace' } },
      send: async ({ url, selectorOverride }) => {
        if (url.includes('preview-runtime')) return { status: 'ready', configured: true, runtime };
        if (selectorOverride.siteId === 'site-b') return new Promise(resolve => { pendingSite = resolve; });
        return snapshot();
      },
    } } };
  const node = type => markRaw({ type, children: [], parent: null, props: {}, style: {}, ...(type === 'iframe' ? {
    contentWindow: { postMessage: (...args) => messages.push(args) },
  } : {}) });
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('text'), text }), createComment: text => ({ ...node('comment'), text }),
    insert(child, parent, anchor) { child.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, child); },
    remove(child) { const i = child.parent?.children.indexOf(child); if (i >= 0) child.parent.children.splice(i, 1); child.parent = null; },
    setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
    patchProp: (n, key, _old, value) => { n.props[key] = value; },
  });
  const findFrame = n => n.type === 'iframe' ? n : n.children.map(findFrame).find(Boolean);
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick(); };
  let app;
  try {
    const { SitePreviewView } = await server.ssrLoadModule('/src/views/dashboard/site-preview.tsx');
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/preview', component: SitePreviewView }] });
    await router.push('/preview?workspaceId=workspace&siteId=site-a'); await router.isReady();
    app = renderer.createApp({ render: () => h(RouterView) });
    app.provide(ssrContextKey, { modules: new Set() });
    app.use(router); app.use(createI18n({ legacy: false, missingWarn: false, fallbackWarn: false, messages: { en: {} } }));
    const root = node('root'); app.mount(root); await flush();
    const oldFrame = findFrame(root); assert.ok(oldFrame);
    const ready = source => ({ origin: 'https://preview.example', source,
      data: { type: 'storefront:preview-ready', templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1 } });
    listeners.get('message')(ready(oldFrame.contentWindow));
    assert.equal(messages.length, 1);
    await router.push('/preview?workspaceId=workspace&siteId=site-b'); await flush();
    assert.ok(!findFrame(root), 'old descriptor must be cleared while the next site loads');
    assert.equal(typeof pendingSite, 'function');
    const nextSite = snapshot(); nextSite.siteId = 'site-b'; pendingSite(nextSite); await flush();
    const newFrame = findFrame(root); assert.ok(newFrame); assert.notEqual(newFrame, oldFrame);
    listeners.get('message')(ready(oldFrame.contentWindow)); assert.equal(messages.length, 1);
    listeners.get('message')(ready(newFrame.contentWindow)); assert.equal(messages.length, 2);
    assert.equal(messages[1][0].payload.siteId, 'site-b');
    app.unmount();
    const { VisualPageEditor } = await server.ssrLoadModule('/src/components/studio/visual-page-editor.tsx');
    const props = reactive({ modelValue: { version: 1, mode: 'template', root: [] }, navigation: [],
      previewPayload: snapshot(), previewUrl: runtime.url, templateId: 'aeroframe', templateVersion: '1.0.3' });
    app = renderer.createApp({ render: () => h(VisualPageEditor, props) });
    app.provide(ssrContextKey, { modules: new Set() });
    const editorRoot = node('root'); app.mount(editorRoot); await flush();
    const editorFrame = findFrame(editorRoot); assert.ok(editorFrame);
    editorFrame.props.onLoad();
    assert.equal(messages.length, 2, 'iframe load alone must not send a private draft');
    listeners.get('message')(ready(editorFrame.contentWindow)); assert.equal(messages.length, 3);
    props.previewPayload = { ...snapshot(), siteName: 'Unsaved change' }; await flush();
    assert.equal(messages.length, 4, 'same-site draft edits retain the verified handshake');
    props.previewUrl = 'https://preview.example/preview/aeroframe/1.0.4/'; props.templateVersion = '1.0.4';
    props.previewPayload = { ...snapshot(), siteId: 'site-c' }; await flush();
    assert.equal(messages.length, 4, 'changing identity must retire the previous handshake before sending');
  } finally { app?.unmount(); globalThis.window = originalWindow; await server.close(); }
});
