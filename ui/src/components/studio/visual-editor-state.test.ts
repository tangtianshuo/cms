import assert from 'node:assert/strict';
import test from 'node:test';
import { reactive } from 'vue';
import { createVisualHistory, dirtyFingerprint, moveNavigationNode, moveNode, toggleNode, updateNodeProps, type VisualNode } from './visual-editor-state';

const nodes = () => [
    { id: 'a', kind: 'section' as const, type: 'hero', enabled: true, props: { title: 'A' }, children: [] },
    { id: 'b', kind: 'section' as const, type: 'feature', enabled: true, props: {}, children: [] },
    { id: 'c', kind: 'section' as const, type: 'faq', enabled: false, props: {}, children: [] },
];

test('moves sections before, after and to the end without mutating the original tree', () => {
    const source: any[] = nodes();
    assert.deepEqual(moveNode(source, 'c', { position: 'before', targetId: 'a' }).map(node => node.id), ['c', 'a', 'b']);
    assert.deepEqual(moveNode(source, 'a', { position: 'after', targetId: 'c' }).map(node => node.id), ['b', 'c', 'a']);
    assert.deepEqual(moveNode(source, 'a', { position: 'end' }).map(node => node.id), ['b', 'c', 'a']);
    assert.deepEqual(source.map(node => node.id), ['a', 'b', 'c']);
});

test('supports node updates and rejects invalid or cyclical moves', () => {
    const source: any[] = [{ ...nodes()[0], children: [{ ...nodes()[1], children: [] }] }, nodes()[2]];
    assert.equal(toggleNode(source, 'a', false)[0].enabled, false);
    assert.equal(updateNodeProps(source, 'b', { tone: 'dark' })[0].children[0].props.tone, 'dark');
    assert.throws(() => moveNode(source, 'missing', { position: 'end' }), /node/i);
    assert.throws(() => moveNode(source, 'a', { position: 'inside', targetId: 'b' }), /descendant|target/i);
});

test('moves navigation nodes into and out of groups and fingerprints dirty state deterministically', () => {
    const nav: any[] = [{ id: 'group', label: 'Group', enabled: true, children: [] }, { id: 'page', label: 'Page', href: '/page', enabled: true, children: [] }];
    const nested = moveNavigationNode(nav, 'page', { position: 'inside', targetId: 'group' });
    assert.deepEqual(nested[0].children.map((node: any) => node.id), ['page']);
    const out = moveNavigationNode(nested, 'page', { position: 'before', targetId: 'group' });
    assert.deepEqual(out.map(node => node.id), ['page', 'group']);
    assert.equal(dirtyFingerprint({ b: 1, a: 2 }), dirtyFingerprint({ a: 2, b: 1 }));
});

test('restores the previous layout after an edit and clears redo after a new edit', () => {
    const history = createVisualHistory(nodes());
    history.apply((value) => toggleNode(value, 'a', false));
    assert.equal(history.value[0].enabled, false);
    history.undo();
    assert.equal(history.value[0].enabled, true);
    history.redo();
    assert.equal(history.value[0].enabled, false);
    history.apply((value) => updateNodeProps(value, 'a', { title: 'Changed' }));
    assert.throws(() => history.redo(), /redo/i);
});

test('edits and moves reactive array/object proxies without mutating source or complex props', () => {
    const source: VisualNode[] = nodes();
    source[0].props = { title: 'Before', body: { content: [{ text: 'preserved' }] } };
    const proxy = reactive(source);
    const updated = updateNodeProps(proxy, 'a', new Proxy({ title: 'After' }, {}));
    assert.equal(updated[0].props?.title, 'After');
    assert.equal(source[0].props.title, 'Before');
    assert.deepEqual(updated[0].props?.body, { content: [{ text: 'preserved' }] });
    assert.deepEqual(moveNode(proxy, 'a', { position: 'end' }).map(node => node.id), ['b', 'c', 'a']);
});
