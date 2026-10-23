import assert from 'node:assert/strict';
import test from 'node:test';
import { PropFactory } from '../prop/factory';
import { PropType } from '../prop/models/main';
import type { EntryCreateBody } from './models/controller';
import { prepareEntryCreate } from './create';

const title = PropFactory.string();
title.name = 'title';
const slug = PropFactory.string();
slug.name = 'slug';
const template = { props: [title, slug] };

test('new entry saves valid language values and derives content text', () => {
    const body: EntryCreateBody = {
        statuses: [],
        meta: [{ lng: 'en', props: [
            { id: title.id, data: ['New product'] },
            { id: slug.id, data: ['new-product'] },
        ] }],
        content: [{ lng: 'en', nodes: [{ type: 'paragraph' as never, content: [{ type: 'text' as never, text: 'Description' }] }], plainText: '' }],
    };
    const result = prepareEntryCreate(body, template.props, ['en'], [], [], [], [], []);
    assert.equal((result.meta[0].props[0].data as string[])[0], 'New product');
    assert.equal(result.content[0].plainText, '<p>Description</p>');
});

test('new entry rejects invalid values before any write', () => {
    const body: EntryCreateBody = {
        statuses: [],
        meta: [{ lng: 'en', props: [
            { id: title.id, data: [] },
            { id: slug.id, data: ['new-product'] },
        ] }],
        content: [{ lng: 'en', nodes: [], plainText: '' }],
    };
    assert.throws(() => prepareEntryCreate(body, template.props, ['en'], [], [], [], [], []), /required/i);
    body.meta[0].props[0].data = ['New product'];
    body.meta[0].props[1].data = [''];
    assert.throws(() => prepareEntryCreate(body, template.props, ['en'], [], [], [], [], []), /required/i);
    body.meta[0].props[1].data = ['new-product'];
    body.meta[0].props[1].id = title.id;
    assert.throws(() => prepareEntryCreate(body, template.props, ['en'], [], [], [], [], []), /No value found/);
    body.meta[0].props[1].id = slug.id;
    body.content[0].lng = 'fr';
    assert.throws(() => prepareEntryCreate(body, template.props, ['en'], [], [], [], [], []), /matching/i);
});

test('legacy empty entry creation remains valid', () => {
    const result = prepareEntryCreate({ statuses: [], meta: [], content: [] }, template.props, ['en'], [], [], [], [], []);
    assert.deepEqual(result, { statuses: [], meta: [], content: [] });
    assert.equal(PropType.STRING, title.type);
});
