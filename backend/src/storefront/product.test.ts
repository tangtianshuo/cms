import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { Media } from '../media/models/main';
import { createDefaultPageConfig, parseProductPageConfig } from './model';
import { mapProduct, productEntrySlug } from './product';

const template = {
    _id: 'template-1',
    name: 'product',
    props: [
        { id: 'title-id', name: 'title', type: 'STRING', array: false },
        { id: 'slug-id', name: 'slug', type: 'STRING', array: false },
        { id: 'price-id', name: 'price', type: 'NUMBER', array: false },
        { id: 'description-id', name: 'description', type: 'STRING', array: false },
        { id: 'images-id', name: 'images', type: 'MEDIA', array: true },
    ],
} as Template;

const entry = {
    templateId: 'template-1',
    meta: [
        {
            lng: 'en',
            props: [
                { id: 'title-id', data: ['Studio Headphones'] },
                { id: 'slug-id', data: ['studio-headphones'] },
                { id: 'price-id', data: [129] },
                { id: 'description-id', data: ['Balanced sound for daily listening.'] },
                { id: 'images-id', data: [{ _id: 'image-1', alt_text: 'Front view' }] },
            ],
        },
        {
            lng: 'zh-CN',
            props: [
                { id: 'title-id', data: ['录音室耳机'] },
                { id: 'slug-id', data: ['studio-headphones-cn'] },
                { id: 'price-id', data: [129] },
                { id: 'description-id', data: ['适合日常聆听。'] },
                { id: 'images-id', data: [{ _id: 'image-1' }] },
            ],
        },
    ],
} as Entry;

const media = [{ _id: 'image-1', name: 'headphones.jpg', mimetype: 'image/jpeg', altText: 'Headphones' }] as Media[];

test('maps product fields by stable prop IDs and selected language', () => {
    const config = createDefaultPageConfig(template);
    const product = mapProduct(entry, template, media, 'en', config, 'http://localhost:8080');
    assert.equal(product.name, 'Studio Headphones');
    assert.equal(product.slug, 'studio-headphones');
    assert.equal(product.price, 129);
    assert.equal(product.description, 'Balanced sound for daily listening.');
    assert.deepEqual(product.images, [{
        src: 'http://localhost:8080/api/v4/media/image-1/bin/image',
        alt: 'Front view',
    }]);
    assert.equal(productEntrySlug(entry, template, 'zh-CN'), 'studio-headphones-cn');
});

test('rejects unknown sections and unbound template fields', () => {
    const config = createDefaultPageConfig(template);
    assert.throws(() => parseProductPageConfig({
        ...config,
        sections: [{ type: 'custom-script', source: 'window.alert(1)' }],
    }, template));
    assert.throws(() => parseProductPageConfig({
        ...config,
        bindings: { ...config.bindings, price: 'missing-id' },
    }, template));
    assert.throws(() => parseProductPageConfig({
        ...config,
        sections: [{ type: 'product-information', fields: ['description'] }],
    }, template));
});

test('accepts related product links and product specifications in the information section', () => {
    const config = createDefaultPageConfig(template);
    const parsed = parseProductPageConfig({
        ...config,
        sections: config.sections.map(section => section.type === 'product-information'
            ? { ...section, specifications: [{ label: 'Weight', value: '2kg' }], relatedProducts: ['travel-case'], cta: { label: 'Configure', href: '/contact' } }
            : section),
    }, template);
    const information = parsed.sections.find(section => section.type === 'product-information');
    assert.equal(information?.type, 'product-information');
    if (information?.type === 'product-information') assert.deepEqual(information.relatedProducts, ['travel-case']);
});

test('rejects missing required content and mismatched template', () => {
    const config = createDefaultPageConfig(template);
    const incomplete = structuredClone(entry);
    const priceValue = incomplete.meta[0].props.find((prop) => prop.id === 'price-id');
    assert.ok(priceValue);
    (priceValue.data as number[])[0] = -1;
    assert.throws(() => mapProduct(incomplete, template, media, 'en', config, 'http://localhost:8080'));
    assert.throws(() => mapProduct({ ...entry, templateId: 'other' }, template, media, 'en', config, 'http://localhost:8080'));
});
