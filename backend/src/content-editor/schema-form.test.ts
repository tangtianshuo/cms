import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentForm, validateContentValues } from './schema-form';

const preset = {
    id: 'custom', version: '1.0.0', name: 'Custom', description: '',
    theme: { background: '', foreground: '', accent: '', muted: '', font: '' },
    demo: { brand: '', hero: { title: '', subtitle: '', image: '' }, product: { title: '', price: '', image: '', description: '' }, collection: { title: '', description: '', image: '' }, page: { title: '', body: '', image: '' } },
    models: [{ key: 'article', label: 'Article', description: '', singleEntry: false, fields: [{ key: 'title', label: 'Title', type: 'STRING', required: true, array: false }, { key: 'cover', label: 'Cover', type: 'MEDIA', required: false, array: false }] }],
    editor: { schemaVersion: 1, models: [{ modelKey: 'article', fields: [{ key: 'title', label: 'Headline', control: 'rich-text', required: true, description: 'Shown above the fold', default: 'Hello' }] }], pages: [], sections: [], operations: { canCreatePages: true, canEditNavigation: true, canPublish: true } },
} as never;

test('builds a content form from stable field keys and contract metadata', () => {
    assert.deepEqual(buildContentForm(preset, 'article'), [
        { key: 'title', label: 'Headline', control: 'rich-text', required: true, array: false, description: 'Shown above the fold', default: 'Hello' },
        { key: 'cover', label: 'Cover', control: 'media', required: false, array: false },
    ]);
});

test('returns field keyed validation errors for missing required values', () => {
    const schema = buildContentForm(preset, 'article');
    assert.deepEqual(validateContentValues(schema, { title: '', cover: null }), { title: 'Headline is required' });
    assert.deepEqual(validateContentValues(schema, { title: 'Hello', cover: null }), {});
});
