import assert from 'node:assert/strict';
import test from 'node:test';
import { PropType } from '../prop/models/main';
import { editorSchemaForModel } from './editor-schema';

test('editor schema uses template contract labels and controls while retaining model field shape', () => {
    const preset = {
        id: 'custom', version: '1.0.0', name: 'Custom', description: '', theme: { background: '', foreground: '', accent: '', muted: '', font: '' }, demo: { brand: '', hero: { title: '', subtitle: '', image: '' }, product: { title: '', price: '', image: '', description: '' }, collection: { title: '', description: '', image: '' }, page: { title: '', body: '', image: '' } },
        models: [{ key: 'article', label: 'Article', description: '', singleEntry: false, fields: [{ key: 'title', label: 'Old title', type: PropType.STRING, required: true, array: false }, { key: 'cover', label: 'Cover', type: PropType.MEDIA, required: false, array: false }] }],
        pages: [], editor: { schemaVersion: 1, models: [{ modelKey: 'article', fields: [{ key: 'title', label: 'Headline', control: 'rich-text', description: 'Shown above the fold' }] }], pages: [], sections: [], operations: { canCreatePages: true, canEditNavigation: true, canPublish: true } },
    } as never;
    assert.deepEqual(editorSchemaForModel(preset, 'article'), [
        { key: 'title', label: 'Headline', control: 'rich-text', required: true, array: false, description: 'Shown above the fold' },
        { key: 'cover', label: 'Cover', control: 'media', required: false, array: false },
    ]);
});
