import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import { getPreset } from './catalog';
import type { SiteInstallation } from './site-model';
import { adoptPublicTemplate, importPreset, planImport, previewPublicTemplateUpgrade, type ImportSource } from './import';
import { canonicalJson, readPublicRegistry, type VerifiedPublicTemplate } from './registry';
import { resolveInstalledPreset } from './installed';

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
        ensureEnglish: async () => { /* No invalidation callback was supplied. */ },
    };
    return { source, templates, entries, getSite: () => site, failNextCollection: () => { failCollectionOnce = true; } };
}

test('one import creates complete CMS models and draft pages only once', async () => {
    const memory = memorySource();
    const first = await importPreset({ presetId: 'atelier', siteName: 'Studio', includeDemo: false }, memory.source);
    assert.equal(first.status, 'ready');
    assert.equal(first.language, 'en');
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

test('verified public raw manifest survives import, resolve and adoption', async () => {
    const preset = getPreset('aeroframe', '1.0.0')!;
    const sourceCommit = 'd'.repeat(40);
    const rawManifest = JSON.parse(JSON.stringify({ schemaVersion: 1, id: 'aeroframe', version: '1.0.1', name: 'AeroFrame 1.0.1',
        description: preset.description, compatibility: { cmsSchema: 1, releaseSchema: 1 },
        presentation: { theme: preset.theme, demo: preset.demo, ...(preset.showcase ? { showcase: preset.showcase } : {}) },
        models: preset.models, pages: preset.pages, assets: [] }));
    const record = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${createHash('sha256').update(canonicalJson(rawManifest)).digest('hex')}`,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe', imageDigest: `sha256:${'e'.repeat(64)}`,
        sourceCommit, manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available' as const };
    const fetcher: typeof fetch = async (url) => String(url).includes('/commits/registry')
        ? Response.json({ sha: sourceCommit })
        : String(url).endsWith('/registry/index.json') ? Response.json({ schemaVersion: 1, records: [record] }) : Response.json(rawManifest);
    const selected = (await readPublicRegistry(fetcher)).records[0];
    const memory = memorySource();
    const initial = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    assert.equal(resolveInstalledPreset(initial).version, '1.0.0');
    const adopted = await adoptPublicTemplate({ presetId: 'aeroframe', presetVersion: selected.version, expectedUpdatedAt: initial.updatedAt }, {
        ...memory.source, claimSite: async (value, expected) => {
            if (memory.getSite()?.updatedAt !== expected) return false;
            await memory.source.updateSite(value); return true;
        },
    }, selected);
    assert.deepEqual(resolveInstalledPreset(adopted).theme, preset.theme);
    assert.deepEqual(JSON.parse(adopted.presetManifestSnapshot!), rawManifest);
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
        assert.equal(entry.content[0].lng, 'en');
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

test('site namespaces keep independent installations and repeat demo titles', async () => {
    const memory = memorySource();
    const first = { _id: 'site-one', createdAt: 1, updatedAt: 1, slot: 'site-one', workspaceId: 'a', templateNamespace: 'site-one', contentGroupId: 'site-one', name: 'One', presetId: '', presetVersion: '', status: 'empty' as const, importError: '', includeDemo: false, demoSeeded: false, theme: getPreset('atelier')!.theme, models: [], pages: [] };
    await memory.source.addSite(first);
    const one = await importPreset({ presetId: 'atelier', siteName: 'One', includeDemo: true }, memory.source);
    await memory.source.addSite({ ...first, _id: 'site-two', slot: 'site-two', templateNamespace: 'site-two', contentGroupId: 'site-two' });
    const two = await importPreset({ presetId: 'market', siteName: 'Two', includeDemo: true }, memory.source);
    assert.equal(memory.templates.size, 10);
    assert.equal(memory.entries.size, 10);
    assert.ok(one.models.every(model => !two.models.some(other => other.templateId === model.templateId)));
    assert.ok([...memory.entries.values()].every(entry => entry.workspaceId === 'a' && entry.groupId === entry.siteId));
});

test('explicit public adoption changes only the installed version metadata and preserves edits and IDs', async () => {
    const memory = memorySource();
    const initial = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: true }, memory.source);
    const edited = { ...initial, theme: { ...initial.theme, accent: '#123456' },
        pages: initial.pages.map((page) => page.key === 'home' ? { ...page, title: 'Edited home', path: '/' } : page) };
    await memory.source.updateSite(edited);
    const before = memory.getSite()!;
    const manifest = { ...getPreset('aeroframe', '1.0.0')!, version: '1.0.1', name: 'AeroFrame refreshed' };
    const selected = {
        schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1', manifestChecksum: `sha256:${'a'.repeat(64)}`,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40),
        manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available' as const, manifest,
    } as VerifiedPublicTemplate;
    const source: ImportSource = { ...memory.source, claimSite: async (site, expected) => {
        if (memory.getSite()?.updatedAt !== expected) return false;
        await memory.source.updateSite(site);
        return true;
    } };
    const adopted = await adoptPublicTemplate({ presetId: 'aeroframe', presetVersion: '1.0.1',
        expectedUpdatedAt: before.updatedAt }, source, selected);
    assert.equal(adopted.presetVersion, '1.0.1');
    assert.equal(adopted.theme.accent, '#123456');
    assert.equal(adopted.pages.find((page) => page.key === 'home')?.title, 'Edited home');
    assert.deepEqual(adopted.models, before.models);
    assert.equal(memory.entries.size, 5);
    assert.equal(adopted.presetManifestSnapshot && JSON.parse(adopted.presetManifestSnapshot).version, '1.0.1');
    assert.equal(JSON.parse(adopted.publishedTemplateRecord || '{}').imageDigest, selected.imageDigest);
});

test('public adoption rejects an optimistic concurrency conflict without changing the installed version', async () => {
    const memory = memorySource();
    const installed = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    const manifest = { ...getPreset('aeroframe', '1.0.0')!, version: '1.0.1' };
    const selected = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${'a'.repeat(64)}`, imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json',
        status: 'available' as const, manifest } as VerifiedPublicTemplate;
    const source: ImportSource = { ...memory.source, claimSite: async (_site, expected) => {
        assert.equal(expected, installed.updatedAt);
        return false;
    } };
    await assert.rejects(() => adoptPublicTemplate({ presetId: 'aeroframe', presetVersion: '1.0.1',
        expectedUpdatedAt: installed.updatedAt }, source, selected), /changed|refresh/i);
    assert.equal(memory.getSite()?.presetVersion, '1.0.0');
});

test('public adoption is blocked while Gateway publication outcome is unresolved', async () => {
    const memory = memorySource();
    const installed = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    const selected = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${'a'.repeat(64)}`, imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json',
        status: 'available' as const, manifest: { ...getPreset('aeroframe', '1.0.0')!, version: '1.0.1' } } as VerifiedPublicTemplate;
    await memory.source.updateSite({ ...installed, gatewayPublishIntent: JSON.stringify({ status: 'pending' }) });
    await assert.rejects(() => adoptPublicTemplate({ presetId: 'aeroframe', presetVersion: '1.0.1',
        expectedUpdatedAt: installed.updatedAt }, memory.source, selected), /publication is still pending/i);
    assert.equal(memory.getSite()?.presetVersion, '1.0.0');
});

test('upgrade preview accepts a compatible visual update and reports its impact', async () => {
    const memory = memorySource();
    const installed = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    const selected = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${'a'.repeat(64)}`, imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json',
        status: 'available' as const, manifest: { ...getPreset('aeroframe', '1.0.0')!, version: '1.0.1',
            theme: { ...getPreset('aeroframe', '1.0.0')!.theme, accent: '#abcdef' } } } as VerifiedPublicTemplate;
    const preview = previewPublicTemplateUpgrade(installed, selected);
    assert.equal(preview.compatible, true);
    assert.equal(preview.requiresNewInstallation, false);
    assert.match(preview.templateImpact.join(' '), /1\.0\.0.*1\.0\.1/);
    assert.match(preview.contentImpact.join(' '), /保留/);
});

test('upgrade preview requires a new installation when the schema changes', async () => {
    const memory = memorySource();
    const installed = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    const base = getPreset('aeroframe', '1.0.0')!;
    const manifest = structuredClone(base);
    manifest.version = '1.0.1';
    manifest.models[0].fields[0] = { ...manifest.models[0].fields[0], required: !manifest.models[0].fields[0].required };
    const selected = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${'a'.repeat(64)}`, imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json',
        status: 'available' as const, manifest } as VerifiedPublicTemplate;
    const preview = previewPublicTemplateUpgrade(installed, selected);
    assert.equal(preview.compatible, false);
    assert.equal(preview.requiresNewInstallation, true);
    assert.match(preview.contentImpact.join(' '), /新建站点/);
    await assert.rejects(() => adoptPublicTemplate({ presetId: 'aeroframe', presetVersion: '1.0.1', expectedUpdatedAt: installed.updatedAt }, memory.source, selected), /schema changes/i);
    assert.equal(memory.getSite()?.presetVersion, '1.0.0');
});

test('upgrade preview rejects a tampered installed snapshot before adoption', async () => {
    const memory = memorySource();
    const installed = await importPreset({ presetId: 'aeroframe', siteName: 'Field', includeDemo: false }, memory.source);
    await memory.source.updateSite({ ...installed, presetManifestSnapshot: JSON.stringify({ ...getPreset('aeroframe', '1.0.0')!, version: '9.9.9' }) });
    const selected = { schemaVersion: 1 as const, id: 'aeroframe', version: '1.0.1',
        manifestChecksum: `sha256:${'a'.repeat(64)}`, imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit: 'c'.repeat(40), manifestPath: 'templates/aeroframe/1.0.1/template.json',
        status: 'available' as const, manifest: { ...getPreset('aeroframe', '1.0.0')!, version: '1.0.1' } } as VerifiedPublicTemplate;
    assert.throws(() => previewPublicTemplateUpgrade(memory.getSite()!, selected), /does not match/i);
    assert.equal(memory.getSite()?.presetVersion, '1.0.0');
});
