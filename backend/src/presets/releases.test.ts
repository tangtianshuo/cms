import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotFingerprint } from './release-fingerprint';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { Media } from '../media/models/main';
import { getPreset } from './catalog';
import { createPageDraft } from './pages';
import { pageDraft, updatePageDraft } from './pages';
import { buildRelease, publishRelease, rollbackRelease, type ReleaseSource,
    releaseDiff, type ReleaseRecord, type ReleaseInput } from './releases';

function fixture(): ReleaseInput {
    const preset = getPreset('atelier')!;
    const values: Record<string, Record<string, unknown[]>> = {
        home: { title: ['Home'], slug: ['home'], headline: ['Original headline'] },
        product: { title: ['Bag'], slug: ['bag'], price: [45] },
        collection: { title: ['Shop'], slug: ['shop'], products: [{ tid: 'product', eid: 'product-entry' }] },
        'content-page': { title: ['About'], slug: ['about'], summary: ['Our story'] },
        'site-settings': { title: ['Settings'], slug: ['settings'], brandName: ['My brand'],
            navigationPages: [{ tid: 'content-page', eid: 'content-page-entry' }] },
    };
    return {
        site: { _id: 'site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'My Store',
            presetId: preset.id, presetVersion: preset.version, status: 'ready', importError: '',
            includeDemo: false, demoSeeded: false, theme: { ...preset.theme },
            models: preset.models.map((model) => ({ key: model.key, templateId: model.key,
                fields: model.fields.map((field) => ({ key: field.key, propId: field.key })) })),
            pages: preset.pages.map((page) => ({ ...page, status: 'draft', seoDescription: 'Store information' })),
        },
        templates: preset.models.map((model) => ({ _id: model.key, props: model.fields.map((field) => ({
            id: field.key, name: field.key, type: field.type, array: field.array, required: field.required,
        })) } as Template)),
        entries: preset.models.map((model) => ({ _id: `${model.key}-entry`, templateId: model.key,
            meta: [{ lng: 'en', props: Object.entries(values[model.key]).map(([id, data]) => ({ id, data })) }],
        } as Entry)),
        media: [], language: 'en', mediaOrigin: 'https://cms.test', currency: 'USD',
    };
}

test('release expands concrete routes and isolates saved content, theme and navigation', () => {
    const input = fixture();
    const snapshot = buildRelease(input);
    assert.equal(snapshot.siteId, 'site');
    assert.deepEqual(snapshot.pages.map((page) => page.path), ['/', '/collections', '/products/bag', '/pages/about']);
    assert.ok(snapshot.navigation.some((link) => link.path === '/pages/about'));
    assert.equal((JSON.parse(JSON.stringify(snapshot)) as typeof snapshot).navigation.find((link) => link.href === '/pages/about')?.path, '/pages/about');
    input.site.theme.accent = '#000000';
    input.entries.find((entry) => entry.templateId === 'home')!.meta[0].props.find((prop) => prop.id === 'headline')!.data = ['Unpublished'];
    assert.equal(snapshot.pages[0].content.preset.demo.hero.title, 'Original headline');
    assert.equal(snapshot.pages[0].content.preset.theme.accent, '#176a58');
    assert.equal(snapshot.pages[1].content.items?.[0].path, '/products/bag');
});

test('release diff exposes media and template changes for publish confirmation', () => {
    const previous = buildRelease(fixture());
    const next = structuredClone(previous);
    next.templateVersion = '2.0.0';
    next.mediaIds = ['new-media'];
    const diff = releaseDiff(previous, next);
    assert.equal(diff.mediaChanged, true);
    assert.equal(diff.templateChanged, true);
    assert.equal(diff.templateVersion, '2.0.0');
});

test('preflight reports independent field problems with editable object locations', () => {
    const input = fixture();
    const product = input.entries.find(entry => entry.templateId === 'product')!;
    product.meta[0].props.find(prop => prop.id === 'title')!.data = [];
    product.meta[0].props.find(prop => prop.id === 'price')!.data = [-1];
    assert.throws(() => buildRelease(input), (cause: unknown) => {
        const issues = (cause as { issues?: Array<{ entryId: string; field: string; code: string }> }).issues;
        assert.ok(issues, 'structured validation problems are returned together');
        assert.ok(issues.some(issue => issue.entryId === product._id && issue.field === 'title'));
        assert.ok(issues.some(issue => issue.entryId === product._id && issue.field === 'price'));
        return true;
    });
});

test('new fixed pages stay out of the old release and path changes create direct redirects', () => {
    const input = fixture();
    const previous = buildRelease(input);
    const content = input.entries.find((entry) => entry.templateId === 'content-page')!;
    input.site = createPageDraft(input.site, 'delivery', { blueprintKey: 'content',
        title: 'Delivery', path: '/delivery', seoTitle: 'Delivery', seoDescription: 'Details',
        sections: ['story'], entryId: content._id }, content);
    const added = buildRelease({ ...input, previous });
    assert.equal(previous.pages.some((page) => page.path === '/delivery'), false);
    assert.ok(added.navigation.some((link) => link.path === '/delivery'));
    input.site.pages.find((page) => page.key === 'delivery')!.path = '/shipping';
    const renamed = buildRelease({ ...input, previous: added });
    assert.deepEqual(renamed.redirects, [{ from: '/delivery', to: '/shipping' }]);
    input.site.pages.find((page) => page.key === 'delivery')!.path = '/shipping-info';
    assert.deepEqual(buildRelease({ ...input, previous: renamed }).redirects, [
        { from: '/delivery', to: '/shipping-info' }, { from: '/shipping', to: '/shipping-info' },
    ]);
});

test('release rejects missing required values, broken fields, media, links and duplicate paths', () => {
    const missing = fixture();
    missing.entries.find((entry) => entry.templateId === 'home')!.meta[0].props.find((prop) => prop.id === 'headline')!.data = [''];
    assert.throws(() => buildRelease(missing), /headline/i);
    const broken = fixture();
    broken.templates[0].props = [];
    assert.throws(() => buildRelease(broken), /binding/i);
    const media = fixture();
    media.entries.find((entry) => entry.templateId === 'home')!.meta[0].props.push({ id: 'heroImage', data: [{ _id: 'missing' }] as never });
    assert.throws(() => buildRelease(media), /media/i);
    const duplicate = fixture();
    duplicate.entries.push({ ...structuredClone(duplicate.entries.find((entry) => entry.templateId === 'product')!), _id: 'second-product' });
    assert.throws(() => buildRelease(duplicate), /duplicate/i);
    const navigation = fixture();
    navigation.site.pages.find((page) => page.key === 'content')!.enabled = false;
    assert.throws(() => buildRelease(navigation), /navigation/i);
    const language = fixture();
    language.language = 'fr';
    assert.throws(() => buildRelease(language), /language|content/i);
});

function memory() {
    const input = fixture();
    const records: ReleaseRecord[] = [];
    const audits: Array<{ operation: string; error: string }> = [];
    let failActivation = false;
    const source: ReleaseSource = {
        findSite: async () => structuredClone(input.site),
        loadContent: async () => structuredClone(input),
        findRelease: async (id) => records.find((record) => record._id === id) || null,
        insertRelease: async (record) => { records.push(structuredClone(record)); },
        activate: async (site, releaseId) => {
            if (failActivation || (input.site.currentReleaseId || '') !== (site.currentReleaseId || '')) return false;
            input.site.currentReleaseId = releaseId;
            input.site.publishedReleaseIds = [...new Set([...(input.site.publishedReleaseIds || []), releaseId])];
            return true;
        },
        audit: async (event) => { audits.push(event); },
    };
    return { input, source, records, audits, fail: () => { failActivation = true; } };
}

test('publication stores the snapshot before activation and failed publication preserves the pointer', async () => {
    const context = memory();
    const first = await publishRelease(context.source, 'admin', '');
    assert.equal(context.input.site.currentReleaseId, first._id);
    context.fail();
    await assert.rejects(() => publishRelease(context.source, 'admin', first._id), /changed/i);
    assert.equal(context.input.site.currentReleaseId, first._id);
    assert.ok(context.audits.some((event) => event.error));
    await assert.rejects(() => publishRelease(context.source, 'admin', ''), /changed/i);
});

test('rollback restores an immutable snapshot and rejects another site or a failed candidate', async () => {
    const context = memory();
    const first = await publishRelease(context.source, 'admin', '');
    const second = await publishRelease(context.source, 'admin', first._id);
    await rollbackRelease(context.source, 'admin', first._id, second._id);
    assert.equal(context.input.site.currentReleaseId, first._id);
    context.records.push({ ...first, _id: 'foreign', siteId: 'other-site' });
    await assert.rejects(() => rollbackRelease(context.source, 'admin', 'foreign', first._id), /site/i);
    assert.equal(context.input.site.currentReleaseId, first._id);
    context.fail();
    await assert.rejects(() => publishRelease(context.source, 'admin', first._id));
    const candidate = context.records.at(-1)!;
    await assert.rejects(() => rollbackRelease(context.source, 'admin', candidate._id, first._id), /never published/i);
});

test('snapshot storage failure preserves the current release', async () => {
    const context = memory();
    const first = await publishRelease(context.source, 'admin', '');
    context.source.insertRelease = async () => { throw new Error('Storage unavailable'); };
    await assert.rejects(() => publishRelease(context.source, 'admin', first._id), /storage/i);
    assert.equal(context.input.site.currentReleaseId, first._id);
});

test('an audit outage after activation does not turn a successful publication into a failure', async (context) => {
    const log = context.mock.method(console, 'error', () => undefined);
    const state = memory();
    state.source.audit = async () => { throw new Error('Audit unavailable'); };
    const first = await publishRelease(state.source, 'admin', '');
    assert.equal(state.input.site.currentReleaseId, first._id);
    assert.equal(log.mock.callCount(), 1);
});

test('removing a page checks rich text internal links and related published pages', () => {
    const input = fixture();
    const content = input.entries.find((entry) => entry.templateId === 'content-page')!;
    content.meta[0].props.push({ id: 'body', data: [{ nodes: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: '/missing' } }] },
    ] }] }] as never });
    assert.throws(() => buildRelease(input), /internal link/i);
    const related = fixture();
    related.site.pages.find((page) => page.key === 'product')!.enabled = false;
    assert.throws(() => buildRelease(related), /published page/i);
});

test('release validation rejects section CTAs that target unpublished paths', () => {
    const input = fixture();
    input.site.pages.find((page) => page.key === 'home')!.sectionConfigs = [{
        type: 'hero-carousel', enabled: true, data: {
            slides: [{ image: { _id: 'media-1' }, title: 'Sale', order: 0, cta: { href: '/missing' } }],
        },
    }];
    assert.throws(() => buildRelease(input), /internal link/i);
});

test('release preflight rejects section media that is missing or belongs to another site', () => {
    const missing = fixture();
    missing.site.pages.find((page) => page.key === 'home')!.sectionConfigs = [{
        type: 'hero-carousel', enabled: true, data: { slides: [{ image: { _id: 'missing' }, title: 'Sale', order: 0 }] },
    }];
    assert.throws(() => buildRelease(missing), /media.*available/i);

    const foreign = fixture();
    foreign.media = [{ _id: 'foreign', workspaceId: 'default', siteId: 'other-site', mimetype: 'image/png' } as Media];
    foreign.site.pages.find((page) => page.key === 'home')!.sectionConfigs = [{
        type: 'hero-carousel', enabled: true, data: { slides: [{ image: { _id: 'foreign' }, title: 'Sale', order: 0 }] },
    }];
    assert.throws(() => buildRelease(foreign), /media.*available/i);
});

test('a fixed collection page retains its bound description and cover', () => {
    const input = fixture();
    const collection = input.entries.find((entry) => entry.templateId === 'collection')!;
    collection.meta[0].props.push({ id: 'description', data: ['Summer collection'] },
        { id: 'cover', data: [{ _id: 'cover' }] as never });
    input.media.push({ _id: 'cover', mimetype: 'image/jpeg' } as Media);
    input.site = createPageDraft(input.site, 'summer', { blueprintKey: 'collections',
        title: 'Summer', path: '/summer', seoTitle: 'Summer', seoDescription: '',
        sections: ['heading', 'grid'], entryId: collection._id }, collection);
    const page = buildRelease(input).pages.find((item) => item.path === '/summer')!;
    assert.equal(page.content.preset.demo.collection.description, 'Summer collection');
    assert.equal(page.content.preset.demo.collection.image, 'https://cms.test/api/v4/media/cover/bin/image');
});

test('unpublished content does not block release with obsolete internal links or incomplete fields', () => {
    const input = fixture();
    const content = input.entries.find((entry) => entry.templateId === 'content-page')!;
    content.meta[0].props.push({ id: 'body', data: [{ nodes: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Retired', marks: [{ type: 'link', attrs: { href: '/retired' } }] },
    ] }] }] as never });
    input.site.pages.find((page) => page.key === 'content')!.enabled = false;
    const settings = input.entries.find((entry) => entry.templateId === 'site-settings')!;
    settings.meta[0].props.find((prop) => prop.id === 'navigationPages')!.data = [];
    assert.equal(buildRelease(input).pages.some((page) => page.entryId === content._id), false);
    content.meta[0].props.find((prop) => prop.id === 'title')!.data = [];
    assert.doesNotThrow(() => buildRelease(input));
});

test('a fixed page can be retired after its bound Entry has been deleted', () => {
    const input = fixture();
    const content = input.entries.find((entry) => entry.templateId === 'content-page')!;
    input.site = createPageDraft(input.site, 'delivery', { blueprintKey: 'content',
        title: 'Delivery', path: '/delivery', seoTitle: 'Delivery', seoDescription: '',
        sections: ['story'], entryId: content._id }, content);
    const previous = buildRelease(input);
    input.entries = input.entries.filter((entry) => entry._id !== content._id);
    input.site.pages.find((page) => page.key === 'content')!.enabled = false;
    input.entries.find((entry) => entry.templateId === 'site-settings')!.meta[0].props
        .find((prop) => prop.id === 'navigationPages')!.data = [];
    input.site = updatePageDraft(input.site, 'delivery', {
        ...pageDraft(input.site, 'delivery')!, enabled: false,
    }, null);
    assert.equal(buildRelease({ ...input, previous }).pages.some((page) => page.path === '/delivery'), false);
    assert.doesNotThrow(() => updatePageDraft(input.site, 'delivery', {
        ...pageDraft(input.site, 'delivery')!, entryId: '', enabled: false,
    }, null));
    assert.throws(() => updatePageDraft(input.site, 'delivery', {
        ...pageDraft(input.site, 'delivery')!, enabled: true,
    }, null), /binding/i);
});

test('local publication rejects a draft changed after preflight before retaining or activating it', async () => {
    const state = memory();
    const hash = snapshotFingerprint(buildRelease(state.input));
    state.input.site.theme.accent = '#123456';
    await assert.rejects(() => publishRelease(state.source, 'admin', '', hash), /changed after validation/);
    assert.equal(state.records.length, 0);
    assert.equal(state.input.site.currentReleaseId, undefined);
});
