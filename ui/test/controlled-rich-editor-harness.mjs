import { createServer } from 'vite';

// Browser-only fixture: mounts the real controlled component without product hooks.
export async function controlledRichEditorHarness(options = {}) {
    const server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { host: '127.0.0.1', port: 0, hmr: false },
        appType: 'custom',
    });
    const html = `<html><body><div id="app"></div><script type="module">
        import { createApp, reactive, ref, h } from 'vue';
        import { createI18n } from 'vue-i18n';
        import { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector } from 'yjs';
        const options = ${JSON.stringify(options)};
        window.bcms = { sdk: { context: null, store: { user: { methods: { me: () => ({ username: 'Component test' }) } } }, entry: { getAllLite: async () => [] }, media: { getAll: async () => [] } }, throwable: async fn => fn(), modalService: { handlers: { entryContentLinkEdit: { close() {} } } }, useLanguage: () => [ref('en')] };
        const { PropValidator } = await import('/src/util/prop-validation.ts');
        window.bcms.entryPropValidator = new PropValidator();
        window.bcms.sdk.store.widget = { findById: id => options.widgets?.find(widget => widget._id === id) };
        window.bcms.sdk.store.group = { findById: id => options.groups?.find(group => group._id === id) };
        window.bcms.sdk.group = { get: async ({ groupId }) => {
            if (options.deferGroup) { window.groupPending = true; await new Promise(resolve => window.resolveGroup = resolve); window.groupPending = false; }
            return options.groups?.find(group => group._id === groupId);
        } };
        const syncCallbacks = {}; const syncEvents = []; window.syncEvents = syncEvents;
        const entrySync = options.sync ? Object.fromEntries(['ProseCursorUpdate', 'ProseContentUpdate', 'YSyncRequest', 'YSyncResponse'].flatMap(name => [
            ['on' + name, (path, callback) => { syncCallbacks[name] = callback; return () => delete syncCallbacks[name]; }],
            ['emit' + name, (path, ...data) => { syncEvents.push({ name, path, data }); if (name === 'YSyncRequest') queueMicrotask(() => syncCallbacks.YSyncResponse({ shouldSync: false })); }]
        ])) : undefined;
        window.receiveRemoteWidgetEdit = (title) => {
            const remote = new Doc();
            for (const event of syncEvents) if (event.name === 'ProseContentUpdate') applyUpdate(remote, Uint8Array.from(event.data[0]));
            const before = encodeStateVector(remote);
            const findWidget = node => node.nodeName === 'widget' ? node : node.toArray?.().map(findWidget).find(Boolean);
            const widget = findWidget(remote.getXmlFragment(options.propPath));
            const raw = widget.getAttribute('data'); const data = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
            data.props[0].data = [title]; widget.setAttribute('data', typeof raw === 'string' ? JSON.stringify(data) : data);
            syncCallbacks.ProseContentUpdate({ updates: Array.from(encodeStateAsUpdate(remote, before)) });
            remote.destroy();
        };
        const { EntryContentEditor } = await import('/src/components/entry/content/main.tsx');
        const state = reactive({ nodes: options.nodes || [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial controlled content' }] }], disabled: false, unrelated: '', propPath: options.propPath || 'component.rich' }); window.editorState = state;
        createApp({ setup: () => () => h(EntryContentEditor, { entryId: 'component', propPath: state.propPath, entrySync, onEditorMounted: editor => window.testEditor = editor, lngIdx: 0, nodes: state.nodes, disabled: state.disabled, class: state.unrelated, onInput: nodes => state.nodes = nodes }) }).use(createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })).mount('#app');
    </script></body></html>`;
    server.middlewares.use('/b6-controlled-editor', async (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(await server.transformIndexHtml('/b6-controlled-editor', html));
    });
    await server.listen();
    const address = server.httpServer.address();
    return {
        url: `http://127.0.0.1:${address.port}/b6-controlled-editor`,
        close: () => server.close(),
    };
}
