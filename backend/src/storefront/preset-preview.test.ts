import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import { getPreset } from '../presets/catalog';
import type { SiteInstallation } from '../presets/site-model';
import { previewPresetPage } from './preset-preview';

function installation(): SiteInstallation {
    const preset = getPreset('market');
    assert.ok(preset);
    return {
        _id: 'site', createdAt: 1, updatedAt: 1, slot: 'default', name: 'My Store',
        presetId: preset.id, presetVersion: preset.version, status: 'ready', importError: '',
        includeDemo: false, demoSeeded: false, theme: preset.theme,
        models: preset.models.map((model) => ({
            key: model.key, templateId: `${model.key}-template`,
            fields: model.fields.map((field) => ({ key: field.key, propId: `${model.key}:${field.key}` })),
        })),
        pages: preset.pages.map((page) => ({ ...page, status: 'draft' })),
    };
}

function entry(modelKey: string, values: Record<string, unknown[]>): Entry {
    return {
        _id: `${modelKey}-entry`, createdAt: 1, updatedAt: 1,
        templateId: `${modelKey}-template`, userId: 'editor', statuses: [],
        meta: [{ lng: 'en', props: Object.entries(values).map(([key, data]) => ({
            id: `${modelKey}:${key}`, data: data as never,
        })) }],
        content: [{ lng: 'en', nodes: [], plainText: '' }],
    };
}

const options = { availableLanguages: ['en'], relatedEntries: [] as Entry[],
    media: [] as Media[], mediaOrigin: 'http://cms.local', currency: 'USD' };

test('unsaved homepage values and CMS media are rendered in the installed theme', () => {
    const image = { _id: 'image-1', mimetype: 'image/jpeg', altText: 'Studio hero' } as Media;
    const result = previewPresetPage({
        site: installation(), pageKey: 'home', language: 'en',
        entry: entry('home', {
            title: ['Home'], slug: ['home'], headline: ['Changed before save'],
            intro: ['New introduction'], heroImage: [{ _id: 'image-1' }],
        }),
        ...options, media: [image],
    });
    assert.equal(result.kind, 'preset-page');
    assert.equal(result.view, 'home');
    assert.equal(result.preset.demo.brand, 'My Store');
    assert.equal(result.preset.demo.hero.title, 'Changed before save');
    assert.equal(result.preset.demo.hero.image, 'http://cms.local/api/v4/media/image-1/bin/image');
    assert.deepEqual(result.sections, ['hero', 'feature']);
});

test('collection and product previews map their own Entry fields without catalog demo content', () => {
    const site = installation();
    const collection = previewPresetPage({ site, pageKey: 'collections', language: 'en',
        entry: entry('collection', { title: ['Autumn Edit'], slug: ['autumn'], description: ['Layered essentials'] }),
        ...options });
    assert.equal(collection.view, 'collection');
    assert.equal(collection.preset.demo.collection.title, 'Autumn Edit');
    assert.equal(collection.preset.demo.collection.description, 'Layered essentials');
    assert.equal(collection.preset.demo.product.title, '');

    const product = previewPresetPage({ site, pageKey: 'product', language: 'en',
        entry: entry('product', { title: ['Travel bag'], slug: ['travel-bag'], price: [129],
            description: ['Waterproof canvas'] }), ...options });
    assert.equal(product.view, 'product');
    assert.equal(product.preset.demo.product.title, 'Travel bag');
    assert.equal(product.preset.demo.product.price, '$129.00');
    assert.equal(product.preset.demo.product.description, 'Waterproof canvas');
});

test('content page preview uses rich text from the selected language', () => {
    const result = previewPresetPage({ site: installation(), pageKey: 'content', language: 'en',
        entry: entry('content-page', { title: ['Delivery'], slug: ['delivery'],
            body: [{ nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ships in two days.' }] }] }],
            seoDescription: ['Delivery information'] }), ...options });
    assert.equal(result.view, 'page');
    assert.equal(result.preset.demo.page.body, 'Ships in two days.');
    assert.equal(result.seo.description, 'Delivery information');
});

test('preview rejects a wrong template, unavailable language, and missing bound field IDs', () => {
    const site = installation();
    const valid = entry('home', { title: ['Home'], slug: ['home'], headline: ['Hello'] });
    assert.throws(() => previewPresetPage({ site, pageKey: 'content', entry: valid,
        language: 'en', ...options }), /template/i);
    assert.throws(() => previewPresetPage({ site, pageKey: 'home', entry: valid,
        language: 'fr', ...options }), /language/i);
    const rogue = entry('home', { title: ['Home'], slug: ['home'], headline: ['Hello'] });
    rogue.meta[0].props = rogue.meta[0].props.filter((prop) => prop.id !== 'home:headline');
    rogue.meta[0].props.push({ id: 'other:headline', data: ['Injected'] });
    assert.throws(() => previewPresetPage({ site, pageKey: 'home', entry: rogue,
        language: 'en', ...options }), /bound field/i);
});

test('configured carousel, gallery and SEO media resolve to CMS URLs and preview capabilities', () => {
    const site = installation();
    site.operations = { seoTitle: 'Social title', seoDescription: '', socialImage: { _id: 'image-1' }, favicon: { _id: 'image-1' }, contactFormEnabled: false };
    site.pages.find(page => page.key === 'home')!.sectionConfigs = [{ type: 'hero-carousel', enabled: true, data: { slides: [{ image: { _id: 'image-1' }, title: 'Banner', order: 0 }] } }];
    const media = [{ _id: 'image-1', siteId: 'site', mimetype: 'image/png', accessToken: 'preview-cap' }] as Media[];
    const result = previewPresetPage({ site, pageKey: 'home', language: 'en', entry: entry('home', { title: ['Home'], slug: ['home'], headline: ['Hello'] }), ...options, media });
    const expected = 'http://cms.local/api/v4/media/image-1/bin/image?cap=preview-cap';
    assert.equal((result.sectionConfigs![0].data.slides as Array<{ image: string }>)[0].image, expected);
    assert.equal(result.operations?.socialImageUrl, expected);
    assert.equal(result.operations?.faviconUrl, expected);
    assert.deepEqual((site.pages.find(page => page.key === 'home')!.sectionConfigs![0].data.slides as unknown[])[0], { image: { _id: 'image-1' }, title: 'Banner', order: 0 });
    site.pages.find(page => page.key === 'product')!.sectionConfigs = [
        { type: 'product-gallery', enabled: true, data: { images: [{ _id: 'image-1' }] } },
        { type: 'product-information', enabled: true, data: {} },
        { type: 'product-description', enabled: true, data: { body: 'Product details' } },
    ];
    const product = previewPresetPage({ site, pageKey: 'product', language: 'en', entry: entry('product', { title: ['Product'], slug: ['product'], price: [10] }), ...options, media });
    assert.deepEqual(product.sectionConfigs![0].data.images, [expected]);
});
