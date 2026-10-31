import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import { getPreset } from './catalog';
import type { SiteInstallation } from './site-model';
import { createPageDraft, pageDraft, updatePageDraft } from './pages';

function site(): SiteInstallation {
    const preset = getPreset('atelier');
    assert.ok(preset);
    return {
        _id: 'site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'Studio',
        presetId: preset.id, presetVersion: preset.version, status: 'ready', importError: '',
        includeDemo: false, demoSeeded: false, theme: preset.theme,
        models: [{ key: 'home', templateId: 'home-template', fields: [] }],
        pages: preset.pages.map((page) => ({ ...page, status: 'draft' })),
    };
}

test('old installations receive page configuration defaults without mutation', () => {
    const installed = site();
    const home = pageDraft(installed, 'home');
    assert.deepEqual(home?.sections, ['hero', 'feature']);
    assert.equal(home?.seoTitle, 'Home');
    assert.equal(home?.seoDescription, '');
    assert.equal(home?.entryId, '');
    assert.equal(installed.pages[0].sections, undefined);
});

test('a valid page update saves SEO and selected sections while preserving its draft state', () => {
    const installed = site();
    const updated = updatePageDraft(installed, 'collections', {
        title: 'Shop collections', path: '/shop', seoTitle: 'Shop the edit',
        seoDescription: 'Browse curated goods.', sections: ['heading'], entryId: '',
    });
    assert.equal(pageDraft(updated, 'collections')?.path, '/shop');
    assert.deepEqual(pageDraft(updated, 'collections')?.sections, ['heading']);
    assert.equal(pageDraft(updated, 'collections')?.status, 'draft');
    assert.equal(installed.pages[1].path, '/collections');
});

test('page updates reject unsupported sections and routes that collide with another blueprint', () => {
    const installed = site();
    const base = { title: 'Collections', path: '/collections', seoTitle: '',
        seoDescription: '', sections: ['heading'], entryId: '' };
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, sections: ['story'] }), /section/i);
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, path: '/pages/about' }), /conflict/i);
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, path: '/preview' }), /reserved/i);
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, path: '/presets/atelier' }), /reserved/i);
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, path: '/products/sample' }), /reserved/i);
    assert.throws(() => updatePageDraft(installed, 'collections', { ...base, path: '/api/pages' }), /reserved/i);
    assert.throws(() => updatePageDraft(installed, 'content', { ...base, path: '/other/:slug' }), /fixed/i);
});

test('home Entry binding requires an Entry from the generated home model', () => {
    const installed = site();
    const body = { title: 'Home', path: '/', seoTitle: '', seoDescription: '',
        sections: ['hero'], entryId: 'home-entry' };
    assert.throws(() => updatePageDraft(installed, 'home', body), /entry/i);
    const unrelated = { _id: 'home-entry', templateId: 'another-template' } as Entry;
    assert.throws(() => updatePageDraft(installed, 'home', body, unrelated), /entry/i);
    const homeEntry = { _id: 'home-entry', templateId: 'home-template' } as Entry;
    assert.equal(pageDraft(updatePageDraft(installed, 'home', body, homeEntry), 'home')?.entryId, 'home-entry');
});

test('fixed product route still allows SEO and section edits', () => {
    const installed = site();
    const updated = updatePageDraft(installed, 'product', {
        title: 'Product', path: '/products/:slug', seoTitle: 'Product details',
        seoDescription: '', sections: ['information', 'description'], entryId: '',
    });
    assert.equal(pageDraft(updated, 'product')?.seoTitle, 'Product details');
    assert.deepEqual(pageDraft(updated, 'product')?.sections, ['information', 'description']);
});

test('page section CTAs must target an enabled published page', () => {
    const installed = site();
    assert.throws(() => updatePageDraft(installed, 'home', {
        title: 'Home', path: '/', seoTitle: '', seoDescription: '', sections: ['hero'], entryId: '',
        sectionConfigs: [{ type: 'hero-carousel', enabled: true, data: {
            slides: [{ image: { _id: 'media-1' }, title: 'Sale', order: 0, cta: { href: '/missing' } }],
        } }],
    }), /internal link/);
});

test('additional pages reuse installed blueprints and bind only their own model', () => {
    const installed = site();
    installed.models.push({ key: 'content-page', templateId: 'content-template', fields: [] });
    const bound = { _id: 'delivery', templateId: 'content-template' } as Entry;
    const input = { blueprintKey: 'content', title: 'Delivery', path: '/delivery',
        seoTitle: 'Delivery information', seoDescription: 'Shipping details',
        sections: ['story'], entryId: 'delivery' };
    const updated = createPageDraft(installed, 'delivery-page', input, bound);
    assert.equal(updated.pages.length, installed.pages.length + 1);
    assert.equal(pageDraft(updated, 'delivery-page')?.entryId, 'delivery');
    const edited = updatePageDraft(updated, 'delivery-page', {
        ...input, title: 'Shipping', path: '/shipping', enabled: false, navigation: false,
    }, bound);
    assert.equal(pageDraft(edited, 'delivery-page')?.enabled, false);
    assert.equal(pageDraft(edited, 'delivery-page')?.status, 'draft');
    assert.throws(() => createPageDraft(installed, 'wrong', input,
        { ...bound, templateId: 'outside-site' }), /binding/i);
    assert.throws(() => createPageDraft(updated, 'delivery-page', input, bound), /key/i);
    assert.throws(() => createPageDraft(installed, 'reserved', { ...input, path: '/sitemap.xml' }, bound), /reserved/i);
    assert.throws(() => createPageDraft(installed, 'collision', { ...input, path: '/pages/test' }, bound), /conflict/i);
});

test('page Entry bindings reject another site even when the template matches', () => {
    const installed = { ...site(), workspaceId: 'workspace-a' };
    installed.models.push({ key: 'content-page', templateId: 'content-template', fields: [] });
    const foreign = { _id: 'foreign-entry', templateId: 'content-template', workspaceId: 'workspace-a', siteId: 'other-site' } as Entry;
    assert.throws(() => createPageDraft(installed, 'foreign-page', {
        blueprintKey: 'content', title: 'Foreign', path: '/foreign', seoTitle: 'Foreign', seoDescription: '',
        sections: ['story'], entryId: foreign._id,
    }, foreign), /binding/i);
});
