import assert from 'node:assert/strict';
import test from 'node:test';
import { PropType } from '../prop/models/main';
import { editorSchemaForModel, editorSchemaForSection } from './editor-schema';

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


test('section schema keeps defaults, visibility and complex controls while supplying legacy labels', () => {
    const body = { content: [{ text: 'preserve formatting' }] };
    const preset = { editor: { sections: [{ type: 'hero', props: {
        title: { control: 'text', required: true }, showButton: { control: 'boolean', label: '显示按钮', default: false },
        buttonHref: { control: 'text', description: '按钮链接', visibleWhen: { field: 'showButton', equals: true } },
        body: { control: 'rich-text', default: body },
    } }] } } as never;
    const fields = editorSchemaForSection(preset, 'hero');
    assert.equal(fields[0].label, '标题');
    assert.equal(fields[1].default, false);
    assert.deepEqual(fields[2].visibleWhen, { field: 'showButton', equals: true });
    assert.deepEqual(fields[3].default, body);
    assert.equal(fields[3].control, 'rich-text');
    assert.deepEqual(editorSchemaForSection(preset, 'missing'), []);
});
