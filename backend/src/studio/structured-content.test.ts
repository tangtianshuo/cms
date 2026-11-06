import assert from 'node:assert/strict';
import test from 'node:test';
import { PropType, type Prop } from '../prop/models/main';
import type { Template } from '../template/models/main';
import type { SiteInstallation } from '../presets/site-model';
import type { Entry } from '../entry/models/main';
import { patchEntry } from './business';
import {
    validateStructuredFields,
    validateStructuredNodes,
} from './structured-content';
const props = [
    {
        id: 'title',
        name: 'title',
        label: 'Title',
        type: PropType.STRING,
        required: true,
        array: false,
        data: {},
    },
    {
        id: 'body',
        name: 'body',
        label: 'Body',
        type: PropType.RICH_TEXT,
        required: false,
        array: false,
        data: {},
    },
    {
        id: 'tags',
        name: 'tags',
        label: 'Tags',
        type: PropType.STRING,
        required: false,
        array: true,
        data: {},
    },
] as Prop[];
const template = { _id: 'template', props } as Template;
const site = {
    _id: 'site',
    language: 'en',
    models: [
        {
            key: 'model',
            templateId: 'template',
            fields: props.map((p) => ({ key: p.name, propId: p.id })),
        },
    ],
} as SiteInstallation;
const rich = [
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
                                        text: 'Body',
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
const entry = {
    _id: 'entry',
    templateId: 'template',
    siteId: 'site',
    groupId: 'group',
    updatedAt: 4,
    statuses: [{ lng: 'en', id: 'draft' }],
    meta: [
        {
            lng: 'en',
            props: [
                { id: 'title', data: ['Before'] },
                { id: 'body', data: [] },
                { id: 'tags', data: ['a'] },
            ],
        },
        { lng: 'zh', props: [{ id: 'title', data: ['保留'] }] },
    ],
    content: [{ lng: 'en', nodes: [], plainText: '' }],
} as unknown as Entry;
const resources = {
    widgets: [],
    groups: [],
    templates: [template],
    medias: [],
};
test('structured patch preserves nodes, ordered arrays, other language, status, group and body', () => {
    const updated = patchEntry(site, template, 'model', entry, {
        body: { kind: 'prop-data', data: rich as never },
        tags: { kind: 'prop-data', data: ['b', 'a', 'b'] },
    });
    validateStructuredFields(template, updated.meta[0].props, resources);
    assert.deepEqual(updated.meta[0].props[1].data, rich);
    assert.deepEqual(updated.meta[0].props[2].data, ['b', 'a', 'b']);
    assert.deepEqual(updated.meta[1], entry.meta[1]);
    assert.deepEqual(updated.content, entry.content);
    assert.deepEqual(updated.statuses, entry.statuses);
    assert.equal(updated.groupId, entry.groupId);
    assert.deepEqual(entry.meta[0].props[1].data, []);
});
test('empty optional rich body is accepted; required, unknown fields and malformed nodes fail specifically', () => {
    const updated = patchEntry(site, template, 'model', entry, {
        body: { kind: 'prop-data', data: [{ nodes: [] }] },
    });
    assert.doesNotThrow(() =>
        validateStructuredFields(template, updated.meta[0].props, resources),
    );
    assert.throws(
        () =>
            patchEntry(site, template, 'model', entry, {
                unknown: { kind: 'prop-data', data: [] },
            }),
        /Unknown installed field/,
    );
    for (const nodes of [
        [{ type: 'invented' }],
        [{ type: 'paragraph', content: 'bad' }],
    ]) {
        const bad = structuredClone(updated.meta[0].props);
        bad[1].data = [{ nodes }] as never;
        assert.throws(
            () => validateStructuredFields(template, bad, resources),
            /studio.fields.body/,
        );
    }
    const missing = structuredClone(updated.meta[0].props);
    missing[0].data = [''];
    assert.throws(
        () => validateStructuredFields(template, missing, resources),
        /title.*required/,
    );
});
test('rich node depth is bounded and plain replacement of existing rich content stays rejected', () => {
    let node: any = { type: 'paragraph' };
    for (let i = 0; i < 40; i++)
        node = {
            type: 'bulletList',
            content: [
                { type: 'listItem', content: [{ type: 'paragraph' }, node] },
            ],
        };
    const values = structuredClone(entry.meta[0].props);
    values[1].data = [{ nodes: [node] }] as never;
    assert.throws(
        () => validateStructuredFields(template, values, resources),
        /depth/,
    );
    assert.throws(
        () => patchEntry(site, template, 'model', entry, { body: 'flatten' }),
        /structured/,
    );
});

test('the installed horizontal rule editor node is preserved and invalid leaf shapes fail', async () => {
    const { entryContentNodeToHtml } = await import('../entry/content');
    const node = { type: 'horizontalRule' } as any;
    assert.doesNotThrow(() => validateStructuredNodes([node], resources));
    assert.equal(entryContentNodeToHtml(node), '<hr />');
    for (const patch of [
        { text: 'invalid' },
        { content: [{ type: 'text', text: 'invalid' }] },
        { marks: [{ type: 'bold' }] },
    ])
        assert.throws(
            () => validateStructuredNodes([{ ...node, ...patch }], resources),
            /horizontal rule/,
        );
});

test('structured validation preserves existing field cardinality without a new item-count restriction', () => {
    const values = structuredClone(entry.meta[0].props);
    values[0].data = ['Title', 'Legacy additional value'];
    values[2].data = Array.from({ length: 201 }, (_, index) => 'tag-' + index);
    assert.doesNotThrow(() =>
        validateStructuredFields(template, values, resources),
    );
    assert.equal((values[2].data as string[]).length, 201);
});

test('known nodes obey the installed block, inline, list, leaf and mark grammar', () => {
    const text = { type: 'text', text: 'Retained' };
    const paragraph = { type: 'paragraph', content: [text] };
    const invalid = [
        [text],
        [{ type: 'paragraph', content: [paragraph] }],
        [{ type: 'bulletList', content: [paragraph] }],
        [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
        [{ type: 'listItem', content: [paragraph] }],
        [{ type: 'bulletList', content: [] }],
        [{ type: 'orderedList', content: [{ type: 'listItem', content: [] }] }],
        [
            {
                type: 'codeBlock',
                content: [{ ...text, marks: [{ type: 'bold' }] }],
            },
        ],
        [{ type: 'codeBlock', content: [{ type: 'hardBreak' }] }],
        [{ ...paragraph, marks: [{ type: 'bold' }] }],
        [
            {
                type: 'paragraph',
                content: [
                    { ...text, marks: [{ type: 'bold' }, { type: 'bold' }] },
                ],
            },
        ],
        [
            {
                type: 'paragraph',
                content: [{ type: 'hardBreak', content: [text] }],
            },
        ],
    ];
    for (const nodes of invalid)
        assert.throws(
            () => validateStructuredNodes(nodes, resources),
            /studio.content\.0/,
        );
    const widget = { _id: 'widget', props: [] };
    const valid = [
        paragraph,
        {
            type: 'bulletList',
            content: [
                {
                    type: 'listItem',
                    content: [
                        paragraph,
                        {
                            type: 'orderedList',
                            content: [
                                {
                                    type: 'listItem',
                                    content: [
                                        paragraph,
                                        {
                                            type: 'widget',
                                            attrs: {
                                                data: {
                                                    _id: widget._id,
                                                    props: [],
                                                },
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
        { type: 'codeBlock', content: [text] },
        {
            type: 'paragraph',
            content: [{ type: 'hardBreak', marks: [{ type: 'bold' }] }],
        },
    ];
    assert.doesNotThrow(() => validateStructuredNodes([], resources));
    assert.doesNotThrow(() =>
        validateStructuredNodes(valid, {
            ...resources,
            widgets: [widget as never],
        }),
    );
});
