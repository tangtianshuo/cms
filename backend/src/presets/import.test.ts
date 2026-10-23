import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { getPreset } from './catalog';
import type { SiteInstallation } from './site-model';
import { importPreset, planImport, type ImportSource } from './import';

function memorySource() {
    let site: SiteInstallation | null = null;
    const templates = new Map<string, Template>();
    const entries = new Map<string, Entry>();
    let failCollectionOnce = false;
    const source: ImportSource = {
        findSite: async () => site,
        addSite: async (value) => { site = structuredClone(value); return structuredClone(value); },
        updateSite: async (value) => { site = structuredClone(value); return structuredClone(value); },
        findTemplate: async (name) => templates.get(name) || null,
        addTemplate: async (value) => {
            if (value.name === 'storefront-collection' && failCollectionOnce) {
                failCollectionOnce = false;
                throw new Error('temporary write failure');
            }
            templates.set(value.name, structuredClone(value));
            return structuredClone(value);
        },
        updateTemplate: async (value) => {
            templates.set(value.name, structuredClone(value));
            return structuredClone(value);
        },
        findEntry: async (id) => entries.get(id) || null,
        addEntry: async (value) => { entries.set(value._id, structuredClone(value)); return structuredClone(value); },
        language: async () => 'en',
    };
    return { source, templates, entries, getSite: () => site, failNextCollection: () => { failCollectionOnce = true; } };
}

test('one import creates complete CMS models and draft pages only once', async () => {
    const memory = memorySource();
    const first = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source);
    assert.equal(first.status, 'ready');
    assert.equal(memory.templates.size, 5);
    assert.equal(first.models.length, 5);
    assert.deepEqual(first.pages.map((page) => page.path), ['/', '/collections', '/products/:slug', '/pages/:slug']);
    assert.ok(first.pages.every((page) => page.status === 'draft'));
    assert.equal(memory.entries.size, 0);
    const product = memory.templates.get('product');
    assert.deepEqual(product?.props.map((prop) => prop.name), [
        'title', 'slug', 'price', 'description', 'images', 'sku',
    ]);
    const page = memory.templates.get('storefront-content-page');
    assert.deepEqual(page?.props.find((prop) => prop.name === 'body')?.data.propRichText, []);
    const again = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source);
    assert.equal(again._id, first._id);
    assert.equal(memory.templates.size, 5);
});

test('import plan refuses an unrelated product Template collision', async () => {
    const memory = memorySource();
    memory.templates.set('product', {
        _id: 'user-template', createdAt: 1, updatedAt: 1, name: 'product', label: 'Custom',
        desc: '', userId: 'user', singleEntry: false, props: [],
    });
    const preset = getPreset('atelier');
    assert.ok(preset);
    const plan = await planImport(preset, memory.source);
    assert.equal(plan.models[0].action, 'conflict');
    await assert.rejects(
        importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source),
        /conflict/i,
    );
    assert.equal(memory.getSite(), null);
});

test('import reuses and extends the existing storefront product Template', async () => {
    const memory = memorySource();
    const preset = getPreset('atelier');
    assert.ok(preset);
    const product = preset.models[0];
    memory.templates.set('product', {
        _id: 'existing-product', createdAt: 1, updatedAt: 1, name: 'product', label: 'Products',
        desc: '', userId: '__storefront', singleEntry: false,
        props: product.fields.slice(0, 5).map((field, index) => ({
            id: `existing-${index}`, name: field.key, label: field.label, type: field.type,
            required: field.required, array: field.array, data: {},
        })),
    });
    const plan = await planImport(preset, memory.source);
    assert.equal(plan.models[0].action, 'update');
    const site = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source);
    assert.equal(site.models[0].templateId, 'existing-product');
    assert.equal(site.models[0].fields[0].propId, 'existing-0');
    assert.equal(memory.templates.get('product')?.props.length, 6);
});

test('failed import resumes without duplicating previously created models', async () => {
    const memory = memorySource();
    memory.failNextCollection();
    await assert.rejects(
        importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source),
        /temporary write failure/,
    );
    assert.equal(memory.getSite()?.status, 'failed');
    assert.equal(memory.templates.size, 1);
    const site = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source);
    assert.equal(site.status, 'ready');
    assert.equal(memory.templates.size, 5);
});

test('demo content is seeded once and links into generated Templates', async () => {
    const memory = memorySource();
    const site = await importPreset({ presetId: 'market', siteName: 'North', includeDemo: true }, memory.source);
    assert.equal(site.demoSeeded, true);
    assert.equal(memory.entries.size, 5);
    for (const entry of memory.entries.values()) {
        assert.ok(site.models.some((model) => model.templateId === entry.templateId));
        assert.equal(entry.meta[0].lng, 'en');
    }
    const contentTemplate = memory.templates.get('storefront-content-page');
    const contentEntry = [...memory.entries.values()].find((entry) => entry.templateId === contentTemplate?._id);
    const bodyProp = contentTemplate?.props.find((prop) => prop.name === 'body');
    assert.deepEqual(contentEntry?.meta[0].props.find((prop) => prop.id === bodyProp?.id)?.data,
        [{ nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'We bring useful, well-made goods together in one place.' }] }] }]);
    await importPreset({ presetId: 'market', siteName: 'North', includeDemo: true }, memory.source);
    assert.equal(memory.entries.size, 5);
});

test('concurrent import returns the installation that won the unique slot', async () => {
    const memory = memorySource();
    const preset = getPreset('atelier');
    assert.ok(preset);
    const site = {
        _id: 'winner', createdAt: Date.now(), updatedAt: Date.now(), slot: 'default' as const,
        name: 'Studio', presetId: 'atelier', presetVersion: '1.0.0', status: 'importing' as const,
        importError: '', includeDemo: false, demoSeeded: false, theme: preset.theme,
        models: [], pages: [],
    };
    const source: ImportSource = {
        ...memory.source,
        addSite: async () => {
            await memory.source.addSite(site);
            throw Object.assign(new Error('duplicate key'), { code: 11000 });
        },
    };
    const result = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, source);
    assert.equal(result._id, 'winner');
    assert.equal(result.status, 'importing');
});
