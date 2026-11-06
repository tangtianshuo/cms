import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { controlledRichEditorHarness } from './controlled-rich-editor-harness.mjs';

const group = {
    _id: 'nested-group',
    label: 'Nested group',
    props: [
        {
            id: 'detail',
            name: 'detail',
            label: 'Nested detail',
            type: 'STRING',
            required: false,
            array: false,
            data: {},
        },
    ],
};
const widget = {
    _id: 'rich-widget',
    label: 'Rich widget',
    props: [
        {
            id: 'title',
            name: 'title',
            label: 'Widget title',
            type: 'STRING',
            required: false,
            array: false,
            data: {},
        },
        {
            id: 'tags',
            name: 'tags',
            label: 'Widget tags',
            type: 'STRING',
            required: false,
            array: true,
            data: {},
        },
        {
            id: 'group',
            name: 'group',
            label: 'Nested group',
            type: 'GROUP_POINTER',
            required: false,
            array: true,
            data: { propGroupPointer: { _id: group._id } },
        },
    ],
};
const data = {
    _id: widget._id,
    props: [
        { id: 'title', data: ['Rich widget before'] },
        { id: 'tags', data: ['First', 'Second'] },
        {
            id: 'group',
            data: {
                _id: group._id,
                items: [{ props: [{ id: 'detail', data: ['Nested before'] }] }],
            },
        },
    ],
};
for (const [location, propPath, string, sync] of [
    ['body', 'entry.content.0.nodes', true, false],
    ['metadata', 'entry.meta.0.props.2.data.0.nodes', false, false],
    ['section', 'section.node.body', false, false],
    ['collaboration', 'entry.content.0.nodes', true, true],
])
    test(`real rich widget edits scalar and arrays at ${location} without losing neighbors`, async () => {
        const paragraph = (text) => ({
            type: 'paragraph',
            content: [{ type: 'text', text }],
        });
        const nodes = [
            paragraph('Before neighbor'),
            {
                type: 'bulletList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            paragraph('Nested neighbor'),
                            {
                                type: 'widget',
                                attrs: {
                                    data: string ? JSON.stringify(data) : data,
                                    propPath: 'stale.body.path',
                                    entryId: 'component',
                                },
                            },
                        ],
                    },
                ],
            },
            paragraph('After neighbor'),
        ];
        const server = await controlledRichEditorHarness({
            widgets: [widget],
            groups: [group],
            nodes,
            propPath,
            sync,
        });
        const browser = await chromium.launch({ headless: true });
        const errors = [];
        try {
            const page = await browser.newPage();
            page.setDefaultTimeout(10000);
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(server.url);
            const title = page.getByRole('textbox', {
                name: 'Widget title',
                exact: true,
            });
            await title.waitFor({ timeout: 10000 });
            await title.fill('Rich widget after');
            await page.waitForFunction(() => {
                const node =
                    window.editorState.nodes[1]?.content?.[0]?.content?.[1];
                const data =
                    node &&
                    (typeof node.attrs.data === 'string'
                        ? JSON.parse(node.attrs.data)
                        : node.attrs.data);
                return data?.props[0].data[0] === 'Rich widget after';
            });
            await page
                .getByRole('textbox', { name: 'Nested detail', exact: true })
                .fill('Nested after');
            const tags = page.getByRole('textbox', {
                name: 'Widget tags',
                exact: true,
            });
            await page
                .getByRole('button', {
                    name: 'props.addNewItemTo',
                    exact: true,
                })
                .first()
                .click();
            await tags.nth(2).fill('Third');
            await page
                .getByRole('button', { name: '上移此项', exact: true })
                .nth(2)
                .click();
            await page
                .getByRole('button', { name: '删除此项', exact: true })
                .nth(0)
                .click();
            await page.waitForFunction(() => {
                const raw =
                    window.editorState.nodes[1].content[0].content[1].attrs
                        .data;
                const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return (
                    JSON.stringify(data.props[1].data) ===
                    JSON.stringify(['Third', 'Second'])
                );
            });
            const output = await page.evaluate(() =>
                JSON.parse(JSON.stringify(window.editorState.nodes)),
            );
            assert.equal(
                output[1].content[0].content[1].attrs.propPath,
                propPath + '.1.content.0.content.1.attrs.data',
            );
            assert.equal(
                typeof output[1].content[0].content[1].attrs.data,
                string ? 'string' : 'object',
            );
            const widgetData = output[1].content[0].content[1].attrs.data;
            assert.equal(
                (typeof widgetData === 'string'
                    ? JSON.parse(widgetData)
                    : widgetData
                ).props[2].data.items[0].props[0].data[0],
                'Nested after',
            );
            assert.deepEqual(output[0], nodes[0]);
            assert.deepEqual(output[2], nodes[2]);
            await page.evaluate((nodes) => {
                window.editorState.nodes = nodes;
                window.editorState.unrelated = 'reload';
                window.testEditor.value.commands.setContent({
                    type: 'doc',
                    content: nodes,
                });
            }, output);
            assert.equal(await title.innerText(), 'Rich widget after');
            assert.deepEqual(await tags.allTextContents(), ['Third', 'Second']);
            if (sync) {
                await page.evaluate(() =>
                    window.receiveRemoteWidgetEdit('Remote widget after'),
                );
                await page.waitForFunction(() => {
                    const raw =
                        window.editorState.nodes[1].content[0].content[1].attrs
                            .data;
                    return (
                        (typeof raw === 'string' ? JSON.parse(raw) : raw)
                            .props[0].data[0] === 'Remote widget after'
                    );
                });
                assert.equal(await title.innerText(), 'Remote widget after');
                assert.deepEqual(await tags.allTextContents(), [
                    'Third',
                    'Second',
                ]);
            }
            await page.evaluate(
                () => (window.editorState.propPath = 'section.moved.content'),
            );
            await title.fill('Moved owner edit');
            await page.waitForFunction(
                () =>
                    window.editorState.nodes[1].content[0].content[1].attrs
                        .propPath ===
                    'section.moved.content.1.content.0.content.1.attrs.data',
            );
            await page.evaluate(() => (window.editorState.disabled = true));
            await page.waitForFunction(
                () => !window.testEditor.value.isEditable,
            );
            assert.equal(
                await title.evaluate((el) => Boolean(el.closest('[inert]'))),
                true,
            );
            assert.equal(
                await page
                    .getByRole('button', { name: '删除此项', exact: true })
                    .first()
                    .isDisabled(),
                true,
            );
            if (sync)
                assert.ok(
                    (await page.evaluate(() => window.syncEvents)).some(
                        (event) =>
                            event.name === 'ProseContentUpdate' &&
                            event.path === propPath &&
                            event.data[0].length,
                    ),
                );
            assert.deepEqual(errors, []);
        } catch (error) {
            throw new Error(
                error.message + '\nPage errors: ' + errors.join('; '),
            );
        } finally {
            await browser.close();
            await server.close();
        }
    });

test('rich widget discards a pending group add when its owner becomes disabled', async () => {
    const nodes = [
        {
            type: 'widget',
            attrs: {
                data: {
                    ...data,
                    props: data.props.map((prop) =>
                        prop.id === 'group'
                            ? { ...prop, data: { _id: group._id, items: [] } }
                            : prop,
                    ),
                },
            },
        },
    ];
    const server = await controlledRichEditorHarness({
        widgets: [widget],
        groups: [group],
        deferGroup: true,
        nodes,
        propPath: 'section.pending.body',
    });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(server.url);
        await page
            .getByRole('button', { name: 'props.addNewItemTo', exact: true })
            .nth(1)
            .click();
        await page.waitForFunction(() => window.groupPending === true);
        const before = await page.evaluate(() =>
            JSON.parse(JSON.stringify(window.editorState.nodes)),
        );
        await page.evaluate(() => (window.editorState.disabled = true));
        await page.waitForFunction(() => !window.testEditor.value.isEditable);
        await page.evaluate(() => window.resolveGroup());
        await page.waitForFunction(() => window.groupPending === false);
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        assert.deepEqual(
            await page.evaluate(() =>
                JSON.parse(JSON.stringify(window.editorState.nodes)),
            ),
            before,
        );
    } finally {
        await browser.close();
        await server.close();
    }
});
