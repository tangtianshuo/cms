import assert from 'node:assert/strict';
import test from 'node:test';
import { getPreset } from '../presets/catalog';
import type { SiteInstallation } from '../presets/site-model';
import type { Template } from '../template/models/main';
import type { Entry } from '../entry/models/main';
import { fieldDescriptors, patchEntry, pageOperationIds, assertStudioWrite } from './business';
import { runWithWorkspace } from '../workspaces/context';
const preset = getPreset('aeroframe', '1.0.0')!;
const model = preset.models.find(item => item.key === 'content-page')!;
const template = { _id: 'template', props: model.fields.map((field, index) => ({ ...field, name: field.key, id: `actual-${index}`, data: {} })) } as unknown as Template;
const site = { _id: 'site', language: 'en', models: [{ key: model.key, templateId: template._id, fields: model.fields.map((field, index) => ({ key: field.key, propId: `actual-${index}` })) }] } as SiteInstallation;
const entry = { _id: 'entry', templateId: 'template', updatedAt: 1, meta: [{ lng: 'en', props: [{ id: 'actual-0', data: ['Before'] }, { id: 'actual-1', data: ['before'] }, { id: 'actual-4', data: [{ nodes: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Keep', marks: [{ type: 'bold' }] }] }] }] }, { id: 'custom', data: ['keep'] }] }, { lng: 'zh', props: [{ id: 'actual-0', data: ['保留'] }] }], content: [{ lng: 'en', nodes: [{ type: 'paragraph' }], plainText: '' }], statuses: [] } as unknown as Entry;
test('mapped patch preserves all unedited values, rich text, other languages and content', () => {
    const updated = patchEntry(site, template, 'content-page', entry, { title: 'After' });
    assert.equal((updated.meta[0].props[0].data as string[])[0], 'After');
    assert.deepEqual(updated.meta[0].props.slice(1), entry.meta[0].props.slice(1));
    assert.deepEqual(updated.meta[1], entry.meta[1]);
    assert.deepEqual(updated.content, entry.content);
    assert.equal((entry.meta[0].props[0].data as string[])[0], 'Before');
});
test('rejects flattening rich text and unknown fields; descriptors expose read-only rich text', () => {
    assert.throws(() => patchEntry(site, template, 'content-page', entry, { body: 'Flatten' }), /advanced editor/);
    assert.throws(() => patchEntry(site, template, 'content-page', entry, { injected: 'bad' }), /Unknown/);
    assert.equal(fieldDescriptors(site, template, 'content-page').find(field => field.key === 'body')?.editable, false);
});
test('new rich text is explicitly converted from plain input', () => {
    const created = patchEntry(site, template, 'content-page', null, { title: 'New', slug: 'new', body: 'Hello\nWorld' }, 'actor', 'new-entry');
    assert.deepEqual((created.meta[0].props.find(p => p.id === 'actual-4')!.data as any)[0].nodes[1], { type: 'paragraph', content: [{ type: 'text', text: 'World' }] });
});
test('page operation identity is deterministic and isolated by site', () => {
    assert.deepEqual(pageOperationIds('site', 'operation'), pageOperationIds('site', 'operation'));
    assert.notDeepEqual(pageOperationIds('site', 'operation'), pageOperationIds('other', 'operation'));
});
test('viewer and missing template write grants are rejected', () => {
    const context = { workspaceId: 'default', actorId: 'u', role: 'viewer' as const, admin: false, instanceAdmin: false };
    runWithWorkspace(context, () => assert.throws(() => assertStudioWrite('template', 'put'), /denied/));
    runWithWorkspace({ ...context, role: 'editor' }, () => assert.throws(() => assertStudioWrite('template', 'put'), /denied/));
    runWithWorkspace({ ...context, role: 'editor', templatePermissions: [{ _id: 'template', get: true, post: true, put: true, delete: false }] }, () => assert.doesNotThrow(() => assertStudioWrite('template', 'put')));
});
test('rejects invalid scalar prices and malformed media data', () => {
    const product = preset.models.find(item => item.key === 'product')!;
    const productTemplate = { ...template, props: product.fields.map((field, index) => ({ ...field, name: field.key, id: `product-${index}`, data: {} })) } as unknown as Template;
    const productSite = { ...site, models: [{ key: 'product', templateId: productTemplate._id, fields: product.fields.map((field, index) => ({ key: field.key, propId: `product-${index}` })) }] };
    assert.throws(() => patchEntry(productSite, productTemplate, 'product', null, { title: 'Product', slug: 'product', price: -1 }), /Invalid Price/);
    assert.throws(() => patchEntry(productSite, productTemplate, 'product', null, { title: 'Product', slug: 'product', price: '0' }), /Invalid Price/);
    assert.throws(() => patchEntry(productSite, productTemplate, 'product', null, { title: 'Product', slug: 'product', price: 1, images: [{ tid: 'bad', eid: 'bad' }] }), /Invalid Images/);
});
