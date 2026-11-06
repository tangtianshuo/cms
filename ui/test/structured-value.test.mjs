import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { structuredValue } from '../src/components/studio/structured-value.ts';

test('rich content is cloned without flattening marks, links or lists', () => {
    const data = [
        {
            nodes: [
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [
                                        {
                                            type: 'text',
                                            text: '正文',
                                            marks: [
                                                { type: 'bold' },
                                                {
                                                    type: 'link',
                                                    attrs: {
                                                        href: '/contact',
                                                        target: '_self',
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ];
    const value = structuredValue(data);
    assert.deepEqual(value, { kind: 'prop-data', data });
    value.data[0].nodes[0].content[0].content[0].content[0].text = '修改';
    assert.equal(
        data[0].nodes[0].content[0].content[0].content[0].text,
        '正文',
    );
});
test('Vue reactive nested values preserve undefined, false, zero and order', () => {
    const data = reactive({
        _id: 'group',
        items: [
            { props: [{ id: 'a', data: [false, 0, undefined] }] },
            { props: [{ id: 'b', data: ['second'] }] },
        ],
    });
    const value = structuredValue(data);
    assert.deepEqual(value.data, data);
    value.data.items[0].props[0].data[0] = true;
    assert.equal(data.items[0].props[0].data[0], false);
    assert.ok(2 in value.data.items[0].props[0].data);
});

test('widget defaults and existing widget fields retain their declared nested data', async () => {
    const { propValuesFromSchema } = await import('../src/util/prop.ts');
    globalThis.window = {
        bcms: {
            sdk: {
                widget: {
                    get: async () => ({
                        _id: 'widget',
                        props: [{ id: 'text', type: 'STRING', data: {} }],
                    }),
                },
            },
        },
    };
    const prop = {
        id: 'widget-prop',
        type: 'WIDGET',
        data: { propWidget: { _id: 'widget' } },
    };
    const data = {
        _id: 'widget',
        props: [{ id: 'text', data: ['Keep nested'] }],
    };
    const result = await propValuesFromSchema([prop], [{ id: prop.id, data }]);
    assert.deepEqual(result, [{ id: prop.id, data }]);
    assert.notEqual(result[0].data, data);
});

test('renderer widget serialization is normalized recursively without flattening nested rich fields', async () => {
    const { entryContentNodesForSave } = await import(
        '../src/util/entry-create.ts'
    );
    const inner = {
        _id: 'inner',
        props: [{ id: 'image', data: [{ _id: 'media', alt_text: 'Keep' }] }],
    };
    const nodes = [
        {
            type: 'widget',
            attrs: {
                data: JSON.stringify({
                    _id: 'outer',
                    props: [
                        {
                            id: 'rich',
                            data: [
                                {
                                    nodes: [
                                        {
                                            type: 'widget',
                                            attrs: {
                                                data: JSON.stringify(inner),
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            },
        },
    ];
    const saved = entryContentNodesForSave(nodes);
    assert.deepEqual(
        saved[0].attrs.data.props[0].data[0].nodes[0].attrs.data,
        inner,
    );
    assert.equal(typeof nodes[0].attrs.data, 'string');
});

test('required readonly section collections cannot be submitted empty', async () => {
    const { sectionFieldError } = await import(
        '../src/components/studio/section-property-state.ts'
    );
    for (const control of ['array', 'widget']) {
        const field = {
            key: 'unknown',
            label: 'Required content',
            control,
            required: true,
        };
        for (const value of [undefined, [], {}])
            assert.match(sectionFieldError(field, value), /Required content/);
        assert.equal(sectionFieldError(field, { preserved: 'content' }), null);
    }
});
