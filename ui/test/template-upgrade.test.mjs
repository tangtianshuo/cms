import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createRenderer, h, nextTick, ssrContextKey } from 'vue';

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
    patchProp: (target, key, _oldValue, value) => {
        target.props[key] = value;
    },
    insert(target, parent, anchor) {
        if (target.parent) {
            target.parent.children.splice(
                target.parent.children.indexOf(target),
                1,
            );
        }
        target.parent = parent;
        const index = parent.children.indexOf(anchor);
        parent.children.splice(
            index < 0 ? parent.children.length : index,
            0,
            target,
        );
    },
    remove(target) {
        if (target.parent) {
            target.parent.children.splice(
                target.parent.children.indexOf(target),
                1,
            );
        }
    },
    parentNode: (target) => target.parent,
    nextSibling: (target) =>
        target.parent?.children[target.parent.children.indexOf(target) + 1] ||
        null,
});

const all = (root) => [root, ...root.children.flatMap(all)];
const textOf = (root) => `${root.text}${root.children.map(textOf).join('')}`;

let server;
let presetsModule;
test.before(async () => {
    server = await createServer({
        root: new URL('..', import.meta.url).pathname,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
    });
    presetsModule = await server.ssrLoadModule(
        '/src/views/dashboard/presets.tsx',
    );
});
test.after(async () => {
    await server?.close();
});

async function renderPanel({
    preview,
    canAdopt,
    onAdopt = () => undefined,
    adoptLabel = '采用版本 1.1.0',
}) {
    const { TemplateUpgradePanel } = presetsModule;
    const root = node('root');
    const app = renderer.createApp({
        render: () =>
            h(TemplateUpgradePanel, {
                preview,
                canAdopt,
                adoptLabel,
                onAdopt,
            }),
    });
    app.provide(ssrContextKey, { modules: new Set() });
    app.directive('cy', {});
    app.mount(root);
    await nextTick();
    return { root, app };
}

const migrationPreview = {
    compatible: false,
    requiresNewInstallation: false,
    migrationRequired: true,
    migrationPlan: {
        from: 'service-studio@1.0.0',
        to: 'service-studio@1.1.0',
        steps: [{ op: 'rename-field', model: 'service' }],
    },
    structureChanges: [
        {
            kind: 'field',
            id: 'service/internal-id',
            from: 'summary',
            to: 'description',
        },
    ],
    issues: [
        {
            code: 'required_field_added',
            path: 'service/entry-7b9c/team-member',
        },
    ],
    affectedContent: ['“战略咨询”内容需要补充服务简介'],
    readableChanges: ['服务内容的“摘要”将调整为“服务介绍”'],
    contentImpact: ['现有服务文字会保留，并进入迁移预览'],
    templateImpact: ['服务页面的展示结构会更新'],
};

test('renders representative migration impact without exposing implementation identifiers', async () => {
    const calls = [];
    const compatible = presetsModule.canAdoptTemplate({
        sameTemplate: true,
        installed: false,
        hasPublishedSource: true,
        hasPlan: true,
        busy: false,
        isAdmin: true,
        hasConflicts: false,
        previewCompatible: migrationPreview.compatible,
    });
    const { root, app } = await renderPanel({
        preview: migrationPreview,
        canAdopt: compatible,
        onAdopt: () => calls.push('adopt'),
    });
    try {
        const text = textOf(root);
        assert.match(text, /需要先完成内容迁移预览/);
        assert.match(text, /服务内容的“摘要”将调整为“服务介绍”/);
        assert.match(text, /“战略咨询”内容需要补充服务简介/);
        assert.match(text, /新增了必须填写的内容项/);
        for (const internal of [
            'service-studio@1.1.0',
            'service/internal-id',
            'entry-7b9c',
            'required_field_added',
            'migrationPlan',
            'structureChanges',
            'summary',
            'description',
            'Template',
            'Prop',
            'Entry',
            'Release',
            'Docker',
        ]) {
            assert.equal(
                text.includes(internal),
                false,
                `UI leaked ${internal}`,
            );
        }
        const adopt = all(root).find((item) => item.type === 'button');
        assert.ok(adopt);
        assert.equal(adopt.props.disabled, true);
        adopt.props.onClick({ preventDefault() {} });
        assert.deepEqual(calls, []);
    } finally {
        app.unmount();
    }
});

test('keeps ordinary adoption explicit and render-only', async () => {
    const calls = [];
    const compatible = presetsModule.canAdoptTemplate({
        sameTemplate: true,
        installed: false,
        hasPublishedSource: true,
        hasPlan: true,
        busy: false,
        isAdmin: true,
        hasConflicts: false,
        previewCompatible: true,
    });
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => {
        networkCalls++;
        throw new Error('rendering the preview must not fetch');
    };
    const { root, app } = await renderPanel({
        preview: {
            compatible: true,
            requiresNewInstallation: false,
            migrationRequired: false,
            readableChanges: ['页面内容保持兼容'],
            contentImpact: ['现有内容可以保留'],
            templateImpact: ['页面展示组件将更新'],
        },
        canAdopt: compatible,
        onAdopt: () => calls.push('adopt'),
    });
    try {
        assert.match(textOf(root), /可以保留现有内容并采用此版本/);
        assert.equal(networkCalls, 0);
        const adopt = all(root).find((item) => item.type === 'button');
        assert.ok(adopt);
        assert.equal(adopt.props.disabled, false);
        assert.deepEqual(calls, []);
        adopt.props.onClick({ preventDefault() {} });
        assert.deepEqual(calls, ['adopt']);
    } finally {
        app.unmount();
        globalThis.fetch = originalFetch;
    }
});
