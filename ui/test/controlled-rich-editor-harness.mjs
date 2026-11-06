import { createServer } from 'vite';

// Browser-only fixture: mounts the real controlled component without product hooks.
export async function controlledRichEditorHarness() {
    const server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { host: '127.0.0.1', port: 0, hmr: false },
        appType: 'custom',
    });
    const html = `<html><body><div id="app"></div><script type="module">
        import { createApp, reactive, ref, h } from 'vue';
        import { createI18n } from 'vue-i18n';
        window.bcms = { sdk: { context: null, store: { user: { methods: { me: () => ({ username: 'Component test' }) } } }, entry: { getAllLite: async () => [] }, media: { getAll: async () => [] } }, throwable: async fn => fn(), modalService: { handlers: { entryContentLinkEdit: { close() {} } } }, useLanguage: () => [ref('en')] };
        const { EntryContentEditor } = await import('/src/components/entry/content/main.tsx');
        const state = reactive({ nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial controlled content' }] }], disabled: false, unrelated: '' }); window.editorState = state;
        createApp({ setup: () => () => h(EntryContentEditor, { entryId: 'component', propPath: 'component.rich', lngIdx: 0, nodes: state.nodes, disabled: state.disabled, class: state.unrelated, onInput: nodes => state.nodes = nodes }) }).use(createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })).mount('#app');
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
