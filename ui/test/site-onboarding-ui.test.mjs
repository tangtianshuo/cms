import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRenderer, nextTick, ssrContextKey } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';

// Exercise the real Vue/JSX view with the existing Vite compiler and a small in-memory host.
// The only substituted boundary is the network SDK; tests never connect to a database.
const node = (type, text = '') => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
});
const renderer = createRenderer({
    createElement: (type) => node(type),
    createText: (text) => node('#text', text),
    createComment: (text) => node('#comment', text),
    setText: (target, text) => {
        target.text = text;
    },
    setElementText: (target, text) => {
        target.text = text;
        target.children = [];
    },
    patchProp: (target, key, _old, value) => {
        target.props[key] = value;
    },
    insert(target, parent, anchor) {
        if (target.parent)
            target.parent.children.splice(
                target.parent.children.indexOf(target),
                1,
            );
        target.parent = parent;
        const at = parent.children.indexOf(anchor);
        parent.children.splice(at < 0 ? parent.children.length : at, 0, target);
    },
    remove(target) {
        if (target.parent)
            target.parent.children.splice(
                target.parent.children.indexOf(target),
                1,
            );
    },
    parentNode: (target) => target.parent,
    nextSibling: (target) =>
        target.parent?.children[target.parent.children.indexOf(target) + 1] ||
        null,
});
const all = (root) => [root, ...root.children.flatMap(all)];
const textOf = (root) => `${root.text}${root.children.map(textOf).join('')}`;
const byText = (root, type, text) =>
    all(root).find((item) => item.type === type && textOf(item).includes(text));
const settle = async () => {
    for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        await nextTick();
    }
};
const template = {
    id: 'market',
    version: '1.0.0',
    name: 'Market',
    description: 'Shop',
    heroImage: '/cover.jpg',
    theme: {
        background: '#fff',
        foreground: '#111',
        accent: '#2563eb',
        muted: '#666',
        font: 'sans-serif',
    },
};

let server;
test.before(async () => {
    server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
});
test.after(async () => {
    await server?.close();
});

async function mount({
    site = null,
    scopeSiteId = 'site-a',
    query = '',
    path = '/d/site-setup',
    view = '/src/views/dashboard/site-onboarding.tsx',
    catalog = [template],
    savedState,
} = {}) {
    const data = new Map(),
        requests = [];
    const localStorage = {
        getItem: (key) => data.get(key) || null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key),
    };
    if (savedState)
        localStorage.setItem(
            'cms-site-setup-v1:["user-a","workspace-a","site-a"]',
            JSON.stringify(savedState),
        );
    let current = site;
    const sdk = {
        context: {
            context: {
                actorId: 'user-a',
                workspaceId: 'workspace-a',
                siteId: scopeSiteId,
                admin: true,
            },
            workspace: { name: 'Workspace' },
            site,
        },
        accessToken: { payload: { userId: 'user-a' } },
        async send(request) {
            requests.push(request);
            if (request.url === '/api/v4/presets/catalog')
                return { items: catalog };
            if (request.url === '/api/v4/presets/site')
                return { site: current, checklist: [], pageOptions: {} };
            if (request.url.startsWith('/api/v4/presets/plan/'))
                return {
                    plan: {
                        presetId: 'market',
                        version: '1.0.0',
                        models: [],
                        pages: [],
                    },
                };
            if (request.url === '/api/v4/presets/import') {
                current = {
                    ...current,
                    status: 'ready',
                    presetId: 'market',
                    presetVersion: '1.0.0',
                    name: request.data.siteName,
                    includeDemo: request.data.includeDemo,
                };
                return current;
            }
            throw new Error(`Unexpected request: ${request.url}`);
        },
        language: {
            async getAll() {
                return [];
            },
        },
        template: {
            async getAll() {
                return [];
            },
        },
        async selectContext() {},
    };
    globalThis.window = {
        bcms: { sdk, useLanguage: () => [{}, () => {}] },
        localStorage,
    };
    globalThis.localStorage = localStorage;
    const { default: View } = await server.ssrLoadModule(view);
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:pathMatch(.*)*', component: { render: () => null } },
        ],
    });
    await router.push(`${path}${query}`);
    await router.isReady();
    const app = renderer.createApp(View);
    app.provide(ssrContextKey, { modules: new Set() });
    app.use(router);
    app.use(
        createI18n({
            legacy: false,
            locale: 'zh-CN',
            messages: {},
            missingWarn: false,
            fallbackWarn: false,
        }),
    );
    const root = node('root');
    app.mount(root);
    await settle();
    return { root, requests, app, router };
}

test('the actual wizard validates identity, imports explicitly, previews the selected site and preserves back navigation', async () => {
    const h = await mount({
        site: {
            _id: 'site-a',
            status: 'empty',
            name: '',
            presetId: '',
            presetVersion: '',
            includeDemo: false,
            models: [],
            pages: [],
            updatedAt: 1,
        },
    });
    try {
        assert.ok(textOf(h.root).includes('选择模板'));
        const choice = all(h.root).find(
            (n) =>
                n.type === 'button' &&
                n.props['aria-pressed'] !== undefined &&
                textOf(n).includes('Market'),
        );
        await choice.props.onClick();
        await settle();
        await byText(h.root, 'button', '下一步').props.onClick();
        await settle();
        const name = all(h.root).find(
            (n) => n.type === 'input' && n.props.id === 'site-setup-name',
        );
        assert.ok(name, 'identity step has a labelled site name field');
        await byText(h.root, 'form', '').props.onSubmit({
            preventDefault() {},
        });
        await settle();
        assert.equal(name.props['aria-invalid'], true);
        name.props.onInput({ target: { value: 'My site' } });
        await byText(h.root, 'form', '').props.onSubmit({
            preventDefault() {},
        });
        await settle();
        assert.ok(textOf(h.root).includes('示例内容'));
        assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
        await byText(h.root, 'button', '创建网站草稿').props.onClick();
        await settle();
        assert.equal(
            h.requests.filter((r) => r.url === '/api/v4/presets/import').length,
            1,
        );
        await byText(h.root, 'button', '下一步').props.onClick();
        await settle();
        const preview = all(h.root).find(
            (n) => n.type === 'iframe' && n.props.title === '网站草稿预览',
        );
        assert.ok(
            preview.props.src.includes('workspaceId=workspace-a&siteId=site-a'),
        );
        await byText(h.root, 'button', '上一步').props.onClick();
        await settle();
        assert.ok(textOf(h.root).includes('内容已准备'));
    } finally {
        h.app.unmount();
    }
});

test('opening a ready site shows existing content and a public template uses an honest cover notice', async () => {
    const h = await mount({
        site: {
            _id: 'site-a',
            status: 'ready',
            name: 'Existing',
            presetId: 'market',
            presetVersion: '1.0.0',
            includeDemo: true,
            models: [],
            pages: [],
            updatedAt: 1,
        },
    });
    try {
        assert.ok(textOf(h.root).includes('Existing'));
        assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
    } finally {
        h.app.unmount();
    }
    const publicView = await mount({
        query: '?new=1',
        catalog: [
            {
                ...template,
                sourceCommit: 'abc',
                manifestChecksum: 'sha256:verified',
            },
        ],
    });
    try {
        const choice = all(publicView.root).find(
            (n) =>
                n.type === 'button' &&
                n.props['aria-pressed'] !== undefined &&
                textOf(n).includes('Market'),
        );
        await choice.props.onClick();
        await settle();
        assert.ok(textOf(publicView.root).includes('封面'));
        assert.equal(
            all(publicView.root).filter((n) => n.type === 'iframe').length,
            0,
        );
        assert.equal(
            publicView.requests.filter((r) => r.url === '/api/v4/presets/site')
                .length,
            0,
            'new-site mode does not read the currently selected ready site',
        );
    } finally {
        publicView.app.unmount();
    }
});

test('changing only the new-site query remounts the wizard and never reuses the existing site scope', async () => {
    const h = await mount({
        site: {
            _id: 'site-a',
            status: 'ready',
            name: 'Existing',
            presetId: 'market',
            presetVersion: '1.0.0',
            includeDemo: true,
            models: [],
            pages: [],
            updatedAt: 1,
        },
    });
    try {
        assert.ok(textOf(h.root).includes('内容已准备'));
        await h.router.push('/d/site-setup?new=1');
        await settle();
        assert.ok(textOf(h.root).includes('选择一个模板'));
        assert.equal(
            h.requests.filter((r) => r.url === '/api/v4/presets/site').length,
            1,
        );
        await h.router.push('/d/site-setup');
        await settle();
        assert.ok(textOf(h.root).includes('内容已准备'));
        assert.equal(h.requests.filter((r) => r.method === 'POST').length, 0);
    } finally {
        h.app.unmount();
    }
});
test('the dashboard site actions are hidden throughout setup and appear again at the workbench', async () => {
    const h = await mount({
        view: '/src/layouts/dashboard/site-actions.tsx',
        site: { name: 'Existing' },
    });
    try {
        assert.equal(all(h.root).filter((n) => n.type === 'a').length, 0);
        await h.router.push('/d/site-setup?new=1');
        await settle();
        assert.equal(all(h.root).filter((n) => n.type === 'a').length, 0);
        await h.router.push('/d/studio');
        await settle();
        assert.ok(byText(h.root, 'a', '预览网站'));
        assert.ok(byText(h.root, 'a', '发布更新'));
    } finally {
        h.app.unmount();
    }
});

test('pending-empty imports expose an explicit retry while fresh, importing and ready sites do not', async () => {
    const pending = {
        step: 'content',
        presetId: 'market',
        presetVersion: '1.0.0',
        sourceCommit: '',
        manifestChecksum: '',
        siteName: 'Original',
        includeDemo: true,
        importRequested: true,
    };
    for (const status of ['empty', 'importing', 'ready']) {
        const h = await mount({
            savedState: pending,
            site: {
                _id: 'site-a',
                status,
                name: 'Original',
                presetId: status === 'empty' ? '' : 'market',
                presetVersion: status === 'empty' ? '' : '1.0.0',
                includeDemo: true,
                models: [],
                pages: [],
                updatedAt: Date.now(),
            },
        });
        try {
            const retry = byText(h.root, 'button', '重新检查并重试');
            if (status === 'empty') {
                assert.ok(
                    retry,
                    'pending empty sites have a recoverable explicit action',
                );
                assert.equal(
                    h.requests.filter((r) => r.method === 'POST').length,
                    0,
                );
                const start = h.requests.length;
                await retry.props.onClick();
                await settle();
                assert.equal(h.requests[start].url, '/api/v4/presets/site');
                assert.equal(
                    h.requests.filter((r) => r.method === 'POST').length,
                    1,
                );
                assert.ok(textOf(h.root).includes('内容已准备'));
                assert.equal(
                    byText(h.root, 'button', '重新检查并重试'),
                    undefined,
                );
            } else assert.equal(retry, undefined);
        } finally {
            h.app.unmount();
        }
    }
    const fresh = await mount({
        savedState: { ...pending, importRequested: false },
        site: {
            _id: 'site-a',
            status: 'empty',
            name: 'Original',
            presetId: '',
            presetVersion: '',
            includeDemo: false,
            models: [],
            pages: [],
            updatedAt: 1,
        },
    });
    try {
        assert.equal(byText(fresh.root, 'button', '重新检查并重试'), undefined);
    } finally {
        fresh.app.unmount();
    }
});
