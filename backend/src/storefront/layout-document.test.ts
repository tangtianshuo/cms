import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutFromSectionConfigs, normalizeLayoutDocument, sectionConfigsFromLayout, validateLayoutDocument } from './layout-document';

const contract = { sections: [
    { type: 'hero', singleton: true, required: true, props: {} },
    { type: 'feature', singleton: true, required: false, props: {} },
] };

test('converts section configs to stable template layout nodes and back without semantic drift', () => {
    const source = [{ type: 'hero', enabled: true, data: { title: 'Hello' } }, { type: 'feature', enabled: false, data: { count: 3 } }];
    const layout = layoutFromSectionConfigs(source);
    assert.deepEqual(layout.root.map((node) => node.id), ['section-hero-1', 'section-feature-2']);
    assert.deepEqual(sectionConfigsFromLayout(normalizeLayoutDocument(layout, contract), contract), source);
});

test('rejects unsupported template layout structure, duplicate nodes and contract violations', () => {
    assert.throws(() => validateLayoutDocument({ version: 2, mode: 'template', root: [] }), /unsupported/i);
    const duplicate = layoutFromSectionConfigs([{ type: 'hero', enabled: true, data: {} }, { type: 'hero', enabled: true, data: {} }]);
    duplicate.root[1].id = duplicate.root[0].id;
    assert.throws(() => validateLayoutDocument(duplicate, contract), /invalid template layout node/i);
    assert.throws(() => validateLayoutDocument(layoutFromSectionConfigs([{ type: 'feature', enabled: true, data: {} }]), contract), /required/i);
    assert.throws(() => validateLayoutDocument({ version: 1, mode: 'template', root: [{ id: 'group', kind: 'container', type: 'group', enabled: true, props: {}, children: [] }] }, contract), /invalid template layout node/i);
});
