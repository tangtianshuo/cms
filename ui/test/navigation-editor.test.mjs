import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createRenderer, nextTick, ssrContextKey } from 'vue';

const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
    createElement: (type) => node(type), createText: (text) => node('#text', text), createComment: (text) => node('#comment', text),
    setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; target.children = []; },
    patchProp: (target, key, _old, value) => { target.props[key] = value; },
    insert(target, parent, anchor) { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1); target.parent = parent; const at = parent.children.indexOf(anchor); parent.children.splice(at < 0 ? parent.children.length : at, 0, target); },
    remove(target) { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1); }, parentNode: (target) => target.parent,
    nextSibling: (target) => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
});
const all = (root) => [root, ...root.children.flatMap(all)];
const textOf = (root) => `${root.text}${root.children.map(textOf).join('')}`;
const buttons = (root) => all(root).filter(item => item.type === 'button');
const button = (root, label) => buttons(root).find(item => textOf(item).includes(label));
const settle = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick(); };

let server;
test.before(async () => { server = await createServer({ root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' }); });
test.after(async () => { await server?.close(); });

test('navigation editor emits add, nested, reorder and visibility changes through real events', async () => {
    const { NavigationEditor } = await server.ssrLoadModule('/src/components/studio/navigation-editor.tsx');
    const emitted = [];
    const app = renderer.createApp(NavigationEditor, { modelValue: [], pages: [{ key: 'home', title: 'Home', path: '/' }, { key: 'about', title: 'About', path: '/about' }], 'onUpdate:modelValue': value => emitted.push(value) });
    const root = node('root'); app.provide(ssrContextKey, { modules: new Set() }); app.mount(root); await settle();
    button(root, '添加分组').props.onClick(); await settle();
    assert.equal(emitted.at(-1)[0].label, '新分组');
    const select = all(root).find(item => item.type === 'select');
    select.props.onChange({ target: { value: '/about' } }); button(root, '添加页面').props.onClick(); await settle();
    assert.equal(emitted.at(-1).length, 2);
    const group = emitted.at(-1)[0];
    select.props.onChange({ target: { value: '/' } });
    buttons(root).filter(item => item.props['aria-label'] === undefined && textOf(item).includes('添加页面')).at(-1).props.onClick(); await settle();
    assert.equal(emitted.at(-1).find(item => item.id === group.id).children.length, 1);
    buttons(root).find(item => item.props['aria-label'] === `下移 ${group.label}`).props.onClick(); await settle();
    assert.equal(emitted.at(-1)[1].id, group.id);
    const checkbox = all(root).find(item => item.type === 'input' && item.props.type === 'checkbox');
    checkbox.props.onChange({ target: { checked: false } }); await settle();
    assert.equal(emitted.at(-1).some(item => item.enabled === false), true);
});

test('existing pages can move into and out of groups without duplication', async () => {
    const { h, ref } = await import('vue');
    const { NavigationEditor } = await server.ssrLoadModule('/src/components/studio/navigation-editor.tsx');
    const state = ref([{ id: 'delivery', label: 'Delivery', href: '/delivery', children: [], enabled: true }, { id: 'support', label: 'Support', children: [], enabled: true }]);
    const app = renderer.createApp({ setup: () => () => h(NavigationEditor, { modelValue: state.value, pages: [], 'onUpdate:modelValue': value => { state.value = value; } }) });
    const root = node('root'); app.provide(ssrContextKey, { modules: new Set() }); app.mount(root); await settle();
    const choice = () => all(root).find(item => item.type === 'select' && item.props['aria-label'] === '所属分组 Delivery');
    assert.ok(choice(), 'existing page exposes a destination group');
    choice().props.onChange({ target: { value: 'support' } }); await settle();
    assert.equal(state.value.length, 1); assert.equal(state.value[0].children[0].href, '/delivery');
    choice().props.onChange({ target: { value: '' } }); await settle();
    assert.equal(state.value.length, 2); assert.equal(state.value[0].children.length, 0);
    assert.equal(state.value[1].href, '/delivery'); app.unmount();
});
