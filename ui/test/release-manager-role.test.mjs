import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createRenderer, h, markRaw, nextTick, ssrContextKey } from 'vue';
import { createI18n } from 'vue-i18n';

const operationId = 'operation-private-123';
const releaseId = 'release-private-456';
const failureCode = 'private_failure_code';
const siteId = 'site-private-789';

function renderer() {
    const node = (type, text = '') =>
        markRaw({ type, text, props: {}, children: [], parent: null });
    return createRenderer({
        createElement: (type) => node(type),
        createText: (text) => node('#text', text),
        createComment: (text) => node('#comment', text),
        setText(target, text) {
            target.text = text;
        },
        setElementText(target, text) {
            target.text = text;
            target.children = [];
        },
        patchProp(target, key, _oldValue, value) {
            target.props[key] = value;
        },
        insert(target, parent, anchor) {
            target.parent = parent;
            const index = parent.children.indexOf(anchor);
            parent.children.splice(
                index < 0 ? parent.children.length : index,
                0,
                target,
            );
        },
        remove(target) {
            const index = target.parent?.children.indexOf(target) ?? -1;
            if (index >= 0) target.parent.children.splice(index, 1);
            target.parent = null;
        },
        parentNode: (target) => target.parent,
        nextSibling: (target) =>
            target.parent?.children[
                target.parent.children.indexOf(target) + 1
            ] || null,
    });
}

const textOf = (root) =>
    `${root.text || ''}${root.children.map(textOf).join('')}`;

test('ordinary site managers see human update state without internal diagnostics', async () => {
    const server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
    const originalWindow = globalThis.window;
    const originalStorage = globalThis.sessionStorage;
    try {
        const values = new Map();
        globalThis.sessionStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: (key) => values.delete(key),
        };
        const sdk = {
            context: {
                context: {
                    workspaceId: 'workspace-private',
                    siteId,
                    admin: true,
                    instanceAdmin: false,
                },
            },
            send: async ({ url }) => {
                if (url === '/api/v4/presets/releases/gateway') {
                    return {
                        configured: true,
                        bound: true,
                        siteUrl: 'https://site.example',
                        publishStatus: {
                            operationId,
                            releaseId,
                            status: 'failed',
                            failureCode,
                            activeRevision: 42,
                        },
                    };
                }
                return {
                    currentReleaseId: releaseId,
                    items: [
                        {
                            _id: releaseId,
                            createdAt: 1,
                            createdBy: 'operator',
                            pageCount: 3,
                        },
                    ],
                    audit: [
                        {
                            createdAt: 1,
                            actorId: 'operator',
                            operation: 'publish',
                            releaseId,
                            error: failureCode,
                        },
                    ],
                };
            },
        };
        globalThis.window = {
            bcms: {
                sdk,
                notification: { success: () => undefined },
            },
        };
        const { ReleaseManager } = await server.ssrLoadModule(
            '/src/components/storefront/release-manager.tsx',
        );
        const { en } = await server.ssrLoadModule('/src/i18n/locales/en.ts');
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/d/studio', component: { render: () => null } }],
        });
        await router.push('/d/studio');
        await router.isReady();
        const root = markRaw({
            type: 'root',
            text: '',
            props: {},
            children: [],
            parent: null,
        });
        const app = renderer().createApp({
            render: () =>
                h(ReleaseManager, {
                    onSaved: async () => undefined,
                }),
        });
        const i18n = createI18n({
            legacy: false,
            missingWarn: false,
            fallbackWarn: false,
            messages: { en },
        });
        app.provide(ssrContextKey, { modules: new Set() });
        app.directive('cy', {});
        app.use(router);
        app.use(i18n);
        app.mount(root);
        await new Promise((resolve) => setImmediate(resolve));
        await nextTick();
        await new Promise((resolve) => setImmediate(resolve));
        await nextTick();
        const visible = textOf(root);
        assert.match(visible, /Website updates/);
        assert.match(visible, /latest content update is public/i);
        assert.match(visible, /Website manager/);
        for (const secret of [
            'Gateway',
            'Revision 42',
            operationId,
            releaseId,
            failureCode,
            siteId,
            'operator',
        ]) {
            assert.equal(
                visible.includes(secret),
                false,
                `${secret} must not be visible to an ordinary site manager`,
            );
        }
        app.unmount();
    } finally {
        globalThis.window = originalWindow;
        globalThis.sessionStorage = originalStorage;
        await server.close();
    }
});

test('instance operators retain an explicit raw diagnostics surface', async () => {
    const server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
    const originalWindow = globalThis.window;
    const originalStorage = globalThis.sessionStorage;
    try {
        const values = new Map();
        globalThis.sessionStorage = {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: (key) => values.delete(key),
        };
        globalThis.window = {
            bcms: {
                sdk: {
                    context: {
                        context: {
                            workspaceId: 'workspace-private',
                            siteId,
                            admin: true,
                            instanceAdmin: true,
                        },
                    },
                    send: async ({ url }) => {
                        if (url === '/api/v4/presets/releases/gateway') {
                            return {
                                configured: true,
                                bound: true,
                                siteUrl: 'https://site.example',
                                publishStatus: {
                                    operationId,
                                    releaseId,
                                    status: 'failed',
                                    failureCode,
                                    activeRevision: 42,
                                },
                            };
                        }
                        return {
                            currentReleaseId: releaseId,
                            items: [
                                {
                                    _id: releaseId,
                                    createdAt: 1,
                                    createdBy: 'operator',
                                    pageCount: 3,
                                },
                            ],
                            audit: [
                                {
                                    createdAt: 1,
                                    actorId: 'operator',
                                    operation: 'publish',
                                    releaseId,
                                    error: failureCode,
                                },
                            ],
                        };
                    },
                },
                notification: { success: () => undefined },
            },
        };
        const { ReleaseManager } = await server.ssrLoadModule(
            '/src/components/storefront/release-manager.tsx',
        );
        const { en } = await server.ssrLoadModule('/src/i18n/locales/en.ts');
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/d/studio', component: { render: () => null } }],
        });
        await router.push('/d/studio');
        await router.isReady();
        const root = markRaw({
            type: 'root',
            text: '',
            props: {},
            children: [],
            parent: null,
        });
        const app = renderer().createApp({
            render: () => h(ReleaseManager, { onSaved: async () => undefined }),
        });
        app.provide(ssrContextKey, { modules: new Set() });
        app.directive('cy', {});
        app.use(router);
        app.use(
            createI18n({
                legacy: false,
                missingWarn: false,
                fallbackWarn: false,
                messages: { en },
            }),
        );
        app.mount(root);
        await new Promise((resolve) => setImmediate(resolve));
        await nextTick();
        const visible = textOf(root);
        assert.match(visible, new RegExp(operationId));
        assert.match(visible, new RegExp(releaseId.slice(0, 8)));
        assert.match(visible, /Revision 42/);
        app.unmount();
    } finally {
        globalThis.window = originalWindow;
        globalThis.sessionStorage = originalStorage;
        await server.close();
    }
});
