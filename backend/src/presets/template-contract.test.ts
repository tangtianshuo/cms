import assert from 'node:assert/strict';
import test from 'node:test';
import { PropType } from '../prop/models/main';
import { canonicalChecksum, parseSnapshotEnvelope, parseTemplateArtifact } from './template-contract';

function artifact() {
    const manifest = {
        schemaVersion: 1, id: 'aeroframe', version: '1.0.0', name: 'AeroFrame', description: 'Aircraft',
        compatibility: { cmsSchema: 1, releaseSchema: 1 },
        models: [
            { key: 'home', label: 'Home', description: 'Homepage', singleEntry: true, fields: [
                { key: 'title', label: 'Title', type: PropType.STRING, required: true, array: false },
                { key: 'products', label: 'Products', type: PropType.ENTRY_POINTER, required: false, array: true,
                    referenceModel: 'product' },
            ] },
            { key: 'product', label: 'Products', description: 'Catalog', singleEntry: false, fields: [
                { key: 'title', label: 'Title', type: PropType.STRING, required: true, array: false },
            ] },
        ],
        pages: [{ key: 'home', title: 'Home', path: '/', modelKey: 'home', layout: 'home' }],
        assets: [{ path: 'images/hero.png', checksum: 'a'.repeat(64), mimeType: 'image/png' }],
    };
    return { manifest, record: { schemaVersion: 1, id: manifest.id, version: manifest.version,
        manifestChecksum: canonicalChecksum(manifest), imageDigest: `sha256:${'b'.repeat(64)}`, status: 'available' } };
}

function envelope() {
    const snapshot = { schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', language: 'en',
        pages: [{ path: '/', pageKey: 'home', entryId: 'entry', content: {
            kind: 'preset-page', view: 'home', preset: { id: 'aeroframe', version: '1.0.0', name: 'AeroFrame',
                description: 'Aircraft', theme: { background: '#ffffff', foreground: '#000000', accent: '#ff0000',
                    muted: '#eeeeee', font: 'Arial' }, demo: { brand: 'Aero', hero: { title: 'Home', subtitle: '', image: '' },
                    product: { title: '', price: '', image: '', description: '' },
                    collection: { title: '', description: '', image: '' }, page: { title: '', body: '', image: '' } } },
            sections: [], seo: { title: 'Home', description: '' },
        } }], navigation: [{ label: 'Home', path: '/' }], redirects: [],
    };
    return { schemaVersion: 1, workspaceId: 'workspace', siteId: 'site', releaseId: 'release',
        checksum: canonicalChecksum(snapshot), snapshot };
}

test('canonical SHA-256 sorts recursive object keys, preserves arrays and encodes UTF-8', () => {
    assert.equal(canonicalChecksum({ b: 'é', a: [{ z: 1, x: 2 }, 3] }),
        '371f0dd6b78043fdcfcc13eae4216508162eed0b80dd243be24dfa467037510c');
    assert.notEqual(canonicalChecksum({ a: [3, { x: 2, z: 1 }], b: 'é' }),
        '371f0dd6b78043fdcfcc13eae4216508162eed0b80dd243be24dfa467037510c');
});

test('accepts matching strict v1 publication record and manifest', () => {
    const value = artifact();
    assert.deepEqual(parseTemplateArtifact(value), value);
});

test('rejects mismatched record identity, status, version or checksum', () => {
    for (const change of [
        (a: ReturnType<typeof artifact>) => { a.record.id = 'other'; },
        (a: ReturnType<typeof artifact>) => { a.record.version = '2.0.0'; },
        (a: ReturnType<typeof artifact>) => { a.record.manifestChecksum = '0'.repeat(64); },
        (a: ReturnType<typeof artifact>) => { a.record.status = 'pending'; },
        (a: ReturnType<typeof artifact>) => { a.record.imageDigest = `sha256:${'A'.repeat(64)}`; },
        (a: ReturnType<typeof artifact>) => { a.record.manifestChecksum = 'invalid'; },
    ]) {
        const value = artifact(); change(value);
        assert.throws(() => parseTemplateArtifact(value));
    }
});

test('requires exactly the declared manifest and record fields with supported versions', () => {
    for (const change of [
        (a: ReturnType<typeof artifact>) => { a.manifest.compatibility.cmsSchema = 2; },
        (a: ReturnType<typeof artifact>) => { a.manifest.compatibility.releaseSchema = 2; },
        (a: ReturnType<typeof artifact>) => { a.manifest.schemaVersion = 2; },
        (a: ReturnType<typeof artifact>) => { delete (a.manifest as Partial<typeof a.manifest>).assets; },
        (a: ReturnType<typeof artifact>) => { Object.assign(a.manifest, { script: 'https://evil.test/a.js' }); },
        (a: ReturnType<typeof artifact>) => { Object.assign(a.record, { extra: true }); },
    ]) {
        const value = artifact(); change(value);
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value));
    }
});

test('accepts catalog camelCase field keys and rejects malformed identifiers', () => {
    const value = artifact();
    value.manifest.models[0].fields[0].key = 'heroImage';
    value.manifest.models[0].fields[1].key = 'featuredCollections';
    value.record.manifestChecksum = canonicalChecksum(value.manifest);
    assert.deepEqual(parseTemplateArtifact(value), value);

    for (const invalid of ['HeroImage', 'hero_image', 'hero.image', 'hero/image', 'hero--image']) {
        const candidate = artifact();
        candidate.manifest.models[0].fields[0].key = invalid;
        candidate.record.manifestChecksum = canonicalChecksum(candidate.manifest);
        assert.throws(() => parseTemplateArtifact(candidate), invalid);
    }
});

test('accepts supported image asset extension and MIME combinations', () => {
    for (const [path, mimeType] of [
        ['images/hero.png', 'image/png'],
        ['images/hero.jpg', 'image/jpeg'],
        ['images/hero.jpeg', 'image/jpeg'],
        ['images/hero.webp', 'image/webp'],
        ['images/hero.gif', 'image/gif'],
        ['images/hero.avif', 'image/avif'],
    ]) {
        const value = artifact();
        value.manifest.assets[0] = { ...value.manifest.assets[0], path, mimeType };
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.deepEqual(parseTemplateArtifact(value), value);
    }
});

test('rejects executable, unsupported and MIME-mismatched asset paths', () => {
    for (const [path, mimeType] of [
        ['images/payload.js', 'image/png'],
        ['images/payload.svg', 'image/svg+xml'],
        ['images/payload.exe.png', 'image/png'],
        ['images/hero.png', 'image/jpeg'],
        ['images/hero.webp', 'image/not-real'],
    ]) {
        const value = artifact();
        value.manifest.assets[0] = { ...value.manifest.assets[0], path, mimeType };
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value), `${path} ${mimeType}`);
    }
});

test('rejects duplicate model, field, page and asset keys or paths', () => {
    for (const change of [
        (a: ReturnType<typeof artifact>) => { a.manifest.models.push({ ...a.manifest.models[0] }); },
        (a: ReturnType<typeof artifact>) => { a.manifest.models[0].fields.push({ ...a.manifest.models[0].fields[0] }); },
        (a: ReturnType<typeof artifact>) => { a.manifest.pages.push({ ...a.manifest.pages[0] }); },
        (a: ReturnType<typeof artifact>) => { a.manifest.pages.push({ ...a.manifest.pages[0], key: 'another' }); },
        (a: ReturnType<typeof artifact>) => { a.manifest.assets.push({ ...a.manifest.assets[0] }); },
    ]) {
        const value = artifact(); change(value);
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value));
    }
});

test('rejects reserved page paths except the built-in product detail route', () => {
    const product = artifact();
    product.manifest.pages[0].path = '/products/:slug';
    product.record.manifestChecksum = canonicalChecksum(product.manifest);
    assert.deepEqual(parseTemplateArtifact(product), product);

    for (const path of ['/api', '/preview/items', '/presets/atelier', '/products', '/products/foo']) {
        const value = artifact();
        value.manifest.pages[0].path = path;
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value), path);
    }
});

test('rejects page paths that match the same URL through dynamic segments', () => {
    for (const [first, second] of [
        ['/pages/:slug', '/pages/foo'],
        ['/pages/foo', '/pages/:slug'],
        ['/pages/:slug', '/pages/:id'],
        ['/products/:slug', '/products/foo'],
    ]) {
        const value = artifact();
        value.manifest.pages[0].path = first;
        value.manifest.pages.push({ ...value.manifest.pages[0], key: 'another', path: second });
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value), `${first} and ${second}`);
    }
});

test('accepts distinct paths beside a dynamic page route', () => {
    const value = artifact();
    value.manifest.pages[0].path = '/pages/:slug';
    value.manifest.pages.push({ ...value.manifest.pages[0], key: 'another', path: '/pages/foo/details' });
    value.record.manifestChecksum = canonicalChecksum(value.manifest);
    assert.deepEqual(parseTemplateArtifact(value), value);
});

test('rejects reserved or malformed routes and unresolved references', () => {
    for (const change of [
        (a: ReturnType<typeof artifact>) => { a.manifest.pages[0].path = '/api/items'; },
        (a: ReturnType<typeof artifact>) => { a.manifest.pages[0].path = '/preview'; },
        (a: ReturnType<typeof artifact>) => { a.manifest.pages[0].path = '//evil.test'; },
        (a: ReturnType<typeof artifact>) => { a.manifest.pages[0].modelKey = 'missing'; },
        (a: ReturnType<typeof artifact>) => { a.manifest.models[0].fields[1].referenceModel = 'missing'; },
        (a: ReturnType<typeof artifact>) => { delete a.manifest.models[0].fields[1].referenceModel; },
        (a: ReturnType<typeof artifact>) => { a.manifest.models[0].fields[0].type = 'INVALID' as PropType; },
        (a: ReturnType<typeof artifact>) => { a.manifest.models[0].fields[0].type = 1 as unknown as PropType; },
        (a: ReturnType<typeof artifact>) => { a.manifest.assets[0].path = '../secret'; },
        (a: ReturnType<typeof artifact>) => { a.manifest.assets[0].path = 'https://evil.test/a.png'; },
    ]) {
        const value = artifact(); change(value);
        value.record.manifestChecksum = canonicalChecksum(value.manifest);
        assert.throws(() => parseTemplateArtifact(value));
    }
});

test('accepts a site-scoped ReleaseSnapshot envelope without changing its contents', () => {
    const value = envelope();
    assert.deepEqual(parseSnapshotEnvelope(value), value);
});

test('rejects unknown snapshot fields with the original checksum instead of silently stripping them', () => {
    const value = envelope();
    Object.assign(value.snapshot.pages[0].content.preset.demo.hero, { injected: 'payload' });
    assert.throws(() => parseSnapshotEnvelope(value));
});

test('rejects unknown snapshot fields even when checksum matches the raw input', () => {
    for (const change of [
        (e: ReturnType<typeof envelope>) => { Object.assign(e.snapshot.pages[0].content, { executable: 'alert(1)' }); },
        (e: ReturnType<typeof envelope>) => { Object.assign(e.snapshot.pages[0].content.preset.theme, { injected: true }); },
        (e: ReturnType<typeof envelope>) => { Object.assign(e.snapshot.navigation[0], { hidden: 'value' }); },
    ]) {
        const value = envelope(); change(value);
        value.checksum = canonicalChecksum(value.snapshot);
        assert.throws(() => parseSnapshotEnvelope(value));
    }
});

test('rejects missing or inconsistent envelope identity, schema and snapshot checksum', () => {
    for (const change of [
        (e: ReturnType<typeof envelope>) => { e.siteId = 'other'; },
        (e: ReturnType<typeof envelope>) => { e.workspaceId = ''; },
        (e: ReturnType<typeof envelope>) => { e.snapshot.workspaceId = 'other'; },
        (e: ReturnType<typeof envelope>) => { e.snapshot.schemaVersion = 2; },
        (e: ReturnType<typeof envelope>) => { e.schemaVersion = 2; },
        (e: ReturnType<typeof envelope>) => { e.checksum = '0'.repeat(64); },
        (e: ReturnType<typeof envelope>) => { e.releaseId = ''; },
        (e: ReturnType<typeof envelope>) => { e.snapshot.pages[0].content.view = 'invalid'; },
    ]) {
        const value = envelope(); change(value);
        assert.throws(() => parseSnapshotEnvelope(value));
    }
});
