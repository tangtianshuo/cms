import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import { PropType } from '../prop/models/main';
import type { Template } from '../template/models/main';
import type { SiteInstallation } from './site-model';
import { buildChecklist } from './checklist';

test('checklist links to generated editors and counts only valid entries', () => {
    const site = {
        status: 'ready', models: [
            { key: 'product', templateId: 'product-id', fields: [{ key: 'title', propId: 'title-id' }, { key: 'slug', propId: 'slug-id' }, { key: 'price', propId: 'price-id' }] },
        ],
    } as SiteInstallation;
    const template = {
        props: [
            { id: 'title-id', name: 'title', type: PropType.STRING, required: true },
            { id: 'slug-id', name: 'slug', type: PropType.STRING, required: true },
            { id: 'price-id', name: 'price', type: PropType.NUMBER, required: true },
        ],
    } as Template;
    const entry = {
        _id: 'entry-id',
        meta: [{ lng: 'en', props: [
            { id: 'title-id', data: ['Bag'] },
            { id: 'slug-id', data: ['bag'] },
            { id: 'price-id', data: [] },
        ] }],
    } as Entry;
    const first = buildChecklist(site, { product: template }, { product: [entry] });
    const product = first.find((step) => step.key === 'product');
    assert.equal(product?.complete, false);
    assert.equal(product?.count, 0);
    assert.equal(product?.href, '/d/template/product-id/entry/create');
    (entry.meta[0].props[2].data as number[]).push(0);
    const second = buildChecklist(site, { product: template }, { product: [entry] });
    assert.equal(second.find((step) => step.key === 'product')?.complete, true);
    assert.equal(second.find((step) => step.key === 'product')?.count, 1);
    assert.equal(second.find((step) => step.key === 'product')?.href, '/d/template/product-id/entry/entry-id');
    assert.equal(second.find((step) => step.key === 'publish')?.available, false);
});
