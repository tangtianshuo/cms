import { controlledRichEditorHarness } from '../../ui/test/controlled-rich-editor-harness.mjs';
import { test, expect } from './browser-fixture.mjs';

const workspace = (page) =>
    page.getByRole('region', { name: '内容编辑工作区', exact: true });
async function openRichLink(page, rich, useKeyboard = false) {
    await rich.focus();
    await expect(rich).toBeFocused();
    if (useKeyboard) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ControlOrMeta+A');
    } else {
        await rich
            .locator('a')
            .first()
            .evaluate((el) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                const selection = getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                document.dispatchEvent(new Event('selectionchange'));
            });
    }
    await expect(page.locator('div[style*="opacity: 1"] #link')).toHaveCount(1);
    await page.locator('div[style*="opacity: 1"] #link').click();
}
async function installed(page) {
    return page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((m) => m.key === 'content-page');
        const entry = await sdk.entry.get({
            templateId: model.templateId,
            entryId: model.entries[0].id,
            skipCache: true,
        });
        return {
            templateId: model.templateId,
            entryId: entry._id,
            modelKey: model.key,
            language: state.site.language,
            workspaceId: sdk.context.context.workspaceId,
            siteId: state.site.id,
        };
    });
}

test('structured HTTP writes validate actual generic create/update, Studio and section node shapes', async ({
    page,
    installation,
}) => {
    const result = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((m) => m.key === 'content-page');
        const template = await sdk.template.get({
            templateId: model.templateId,
        });
        const richId = template.props.find((p) => p.type === 'RICH_TEXT').id;
        const get = () =>
            sdk.entry.get({
                templateId: model.templateId,
                entryId: model.entries[0].id,
                skipCache: true,
            });
        const status = async (fn) => {
            try {
                await fn();
                return 200;
            } catch (e) {
                return e.response?.status || e.status || 0;
            }
        };
        const bad = [{ type: 'invented' }];
        const outcomes = [];
        let raw = await get();
        const meta = structuredClone(
            raw.meta.find((m) => m.lng === state.site.language),
        );
        meta.props.find((p) => p.id === richId).data = [{ nodes: bad }];
        outcomes.push(
            await status(() =>
                sdk.entry.update({
                    _id: raw._id,
                    templateId: raw.templateId,
                    expectedUpdatedAt: raw.updatedAt,
                    lng: state.site.language,
                    meta,
                    content: raw.content.find(
                        (c) => c.lng === state.site.language,
                    ),
                }),
            ),
        );
        const unique = crypto.randomUUID().slice(0, 8);
        meta.props[0].data = ['B6 bad ' + unique];
        meta.props[1].data = ['b6-bad-' + unique];
        outcomes.push(
            await status(() =>
                sdk.entry.create({
                    templateId: raw.templateId,
                    data: {
                        statuses: [],
                        meta: [meta],
                        content: [{ lng: meta.lng, nodes: [] }],
                    },
                }),
            ),
        );
        raw = await get();
        outcomes.push(
            await status(() =>
                sdk.studio.saveEntry(model.key, {
                    entryId: raw._id,
                    expectedUpdatedAt: raw.updatedAt,
                    operationId: crypto.randomUUID(),
                    fields: {
                        body: { kind: 'prop-data', data: [{ nodes: bad }] },
                    },
                }),
            ),
        );
        const before = await sdk.studio.getSite();
        const p = before.site.pages.find((p) =>
            p.layoutDocument?.root.some(
                (n) =>
                    before.site.editorContract.sections.find(
                        (s) => s.type === n.type,
                    )?.props.body?.control === 'rich-text',
            ),
        );
        if (!p) throw new Error('Rich section fixture missing');
        const layoutDocument = structuredClone(p.layoutDocument);
        layoutDocument.root.find(
            (n) =>
                before.site.editorContract.sections.find(
                    (s) => s.type === n.type,
                )?.props.body?.control === 'rich-text',
        ).props.body = { nodes: bad };
        outcomes.push(
            await status(() =>
                sdk.studio.savePage(p.key, {
                    expectedUpdatedAt: before.site.updatedAt,
                    title: p.title,
                    path: p.path,
                    seoTitle: p.seoTitle,
                    seoDescription: p.seoDescription,
                    sections: p.sections,
                    layoutDocument,
                    entryId: p.entryId,
                    enabled: p.enabled,
                    navigation: p.navigation,
                }),
            ),
        );
        return outcomes;
    });
    expect(result).toEqual([400, 400, 400, 400]);
});

test('Studio structured rich field saves empty body and rejects stale versions without flattening other languages', async ({
    page,
    installation,
}) => {
    const result = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((m) => m.key === 'content-page');
        const template = await sdk.template.get({
            templateId: model.templateId,
        });
        const richId = template.props.find((p) => p.type === 'RICH_TEXT').id;
        const get = () =>
            sdk.entry.get({
                templateId: model.templateId,
                entryId: model.entries[0].id,
                skipCache: true,
            });
        const raw = await get();
        const nodes = [
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
                                        text: 'B6 link',
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
        ];
        const body = {
            entryId: raw._id,
            expectedUpdatedAt: raw.updatedAt,
            operationId: crypto.randomUUID(),
            fields: { body: { kind: 'prop-data', data: [{ nodes }] } },
        };
        await sdk.studio.saveEntry(model.key, body);
        const saved = await get();
        let stale;
        try {
            await sdk.studio.saveEntry(model.key, body);
            stale = 200;
        } catch (e) {
            stale = e.response?.status || e.status || 0;
        }
        const changed = saved.meta
            .find((m) => m.lng === state.site.language)
            .props.find((p) => p.id === richId).data;
        const untouched = (e) => ({
            meta: e.meta.filter((m) => m.lng !== state.site.language),
            content: e.content,
            statuses: e.statuses,
            groupId: e.groupId,
        });
        await sdk.studio.saveEntry(model.key, {
            ...body,
            expectedUpdatedAt: saved.updatedAt,
            fields: { body: { kind: 'prop-data', data: [{ nodes: [] }] } },
        });
        return {
            stale,
            rich: JSON.stringify(changed) === JSON.stringify([{ nodes }]),
            untouched:
                JSON.stringify(untouched(raw)) ===
                JSON.stringify(untouched(saved)),
            empty: (await get()).meta
                .find((m) => m.lng === state.site.language)
                .props.find((p) => p.id === richId).data,
        };
    });
    expect(result).toEqual({
        stale: 409,
        rich: true,
        untouched: true,
        empty: [{ nodes: [] }],
    });
});

async function structuredFixture(page) {
    return page.evaluate(async (ownMedia) => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const suffix = crypto.randomUUID().slice(0, 8);
        const product = state.models.find((m) => m.key === 'product');
        let widget = await sdk.widget.create({
            label: 'B6 widget ' + suffix,
            desc: '',
        });
        widget = await sdk.widget.update({
            _id: widget._id,
            propChanges: [
                {
                    add: {
                        label: 'Widget text',
                        type: 'STRING',
                        required: false,
                        array: false,
                        data: {},
                    },
                },
            ],
        });
        let group = await sdk.group.create({
            label: 'B6 group ' + suffix,
            desc: '',
        });
        group = await sdk.group.update({
            _id: group._id,
            propChanges: [
                {
                    add: {
                        label: 'Nested widget',
                        type: 'WIDGET',
                        required: false,
                        array: false,
                        data: { propWidget: { _id: widget._id } },
                    },
                },
            ],
        });
        let template = await sdk.template.create({
            label: 'B6 rich ' + suffix,
            desc: '',
            singleEntry: false,
        });
        template = await sdk.template.update({
            _id: template._id,
            propChanges: [
                {
                    add: {
                        label: 'Rich body',
                        type: 'RICH_TEXT',
                        required: false,
                        array: false,
                        data: {},
                    },
                },
                {
                    add: {
                        label: 'Ordered tags',
                        type: 'STRING',
                        required: false,
                        array: true,
                        data: {},
                    },
                },
                {
                    add: {
                        label: 'Image',
                        type: 'MEDIA',
                        required: false,
                        array: false,
                        data: {},
                    },
                },
                {
                    add: {
                        label: 'Related',
                        type: 'ENTRY_POINTER',
                        required: false,
                        array: false,
                        data: {
                            propEntryPointer: [
                                {
                                    templateId: product.templateId,
                                    entryIds: [],
                                    displayProp: 'title',
                                },
                            ],
                        },
                    },
                },
                {
                    add: {
                        label: 'Embedded widget',
                        type: 'WIDGET',
                        required: false,
                        array: false,
                        data: { propWidget: { _id: widget._id } },
                    },
                },
                {
                    add: {
                        label: 'Grouped widgets',
                        type: 'GROUP_POINTER',
                        required: false,
                        array: true,
                        data: { propGroupPointer: { _id: group._id } },
                    },
                },
            ],
        });
        const rich = [
            {
                nodes: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'text',
                                text: 'Keep bold',
                                marks: [{ type: 'bold' }],
                            },
                            {
                                type: 'text',
                                text: ' link',
                                marks: [
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
                    {
                        type: 'bulletList',
                        content: [
                            {
                                type: 'listItem',
                                content: [
                                    {
                                        type: 'paragraph',
                                        content: [
                                            { type: 'text', text: 'Keep list' },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ];
        const props = template.props.map((p, i) => ({
            id: p.id,
            data:
                p.type === 'RICH_TEXT'
                    ? rich
                    : p.type === 'MEDIA'
                      ? [
                            {
                                _id: ownMedia,
                                alt_text: 'Preserve alt',
                                caption: 'Preserve caption',
                            },
                        ]
                      : p.type === 'ENTRY_POINTER'
                        ? [
                              {
                                  tid: product.templateId,
                                  eid: product.entries[0].id,
                              },
                          ]
                        : p.type === 'GROUP_POINTER'
                          ? {
                                _id: group._id,
                                items: [
                                    {
                                        props: [
                                            {
                                                id: group.props[0].id,
                                                data: {
                                                    _id: widget._id,
                                                    props: [
                                                        {
                                                            id: widget.props[0]
                                                                .id,
                                                            data: [
                                                                'Nested before',
                                                            ],
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                    {
                                        props: [
                                            {
                                                id: group.props[0].id,
                                                data: {
                                                    _id: widget._id,
                                                    props: [
                                                        {
                                                            id: widget.props[0]
                                                                .id,
                                                            data: [
                                                                'Sibling preserved',
                                                            ],
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                ],
                            }
                          : p.type === 'WIDGET'
                            ? {
                                  _id: widget._id,
                                  props: [
                                      {
                                          id: widget.props[0].id,
                                          data: ['Widget before'],
                                      },
                                  ],
                              }
                            : p.array
                              ? ['first', 'second', 'third']
                              : [
                                    i === 0
                                        ? 'B6 rich ' + suffix
                                        : 'b6-rich-' + suffix,
                                ],
        }));
        const target = await sdk.entry.get({
            templateId: product.templateId,
            entryId: product.entries[0].id,
            skipCache: true,
        });
        const targetMeta = structuredClone(target.meta);
        for (const meta of targetMeta) {
            meta.props[0].data = ['B6 referenced ' + suffix];
            meta.props[1].data = ['b6-referenced-' + suffix];
        }
        const related = await sdk.entry.create({
            templateId: product.templateId,
            data: { statuses: [], meta: targetMeta, content: target.content },
        });
        const language = state.site.language;
        const other = language === 'fr' ? 'de' : 'fr';
        if (!(await sdk.language.getAll()).some((l) => l.code === other))
            await sdk.language.create({
                code: other,
                name: other,
                nativeName: other,
            });
        const entry = await sdk.entry.create({
            templateId: template._id,
            data: {
                statuses: [],
                meta: [
                    { lng: language, props },
                    {
                        lng: other,
                        props: structuredClone(props).map((p, i) =>
                            i === 0
                                ? { ...p, data: ['Other ' + suffix] }
                                : i === 1
                                  ? { ...p, data: ['other-' + suffix] }
                                  : p,
                        ),
                    },
                ],
                content: [
                    {
                        lng: language,
                        nodes: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'Main body preserved',
                                    },
                                ],
                            },
                        ],
                    },
                    { lng: other, nodes: [] },
                ],
            },
        });
        const languages = await sdk.language.getAll();
        return {
            templateId: template._id,
            entryId: entry._id,
            language,
            languageIndex: languages.findIndex((l) => l.code === language),
            workspaceId: sdk.context.context.workspaceId,
            other,
            original: entry,
            relatedId: related._id,
            relatedTitle: 'B6 referenced ' + suffix,
            paths: Object.fromEntries(
                template.props.map((p, i) => [
                    p.type,
                    `entry.meta.${languages.findIndex((l) => l.code === language)}.props.${i}`,
                ]),
            ),
        };
    }, process.env.STOREFRONT_E2E_OWN_MEDIA);
}

test('one workspace edits rich marks, links, lists, arrays and widget, retains media/references and stale focus', async ({
    page,
    installation,
}, info) => {
    const id = await structuredFixture(page);
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({
                section: 'content',
                templateId: id.templateId,
                entryId: id.entryId,
                language: id.language,
                workspaceId: id.workspaceId,
            }),
    );
    await expect(workspace(page)).toHaveCount(1);
    const rich = page
        .locator('.studio-structured-field[data-field]')
        .filter({ has: page.locator('.bcmsEntryContentEditor') })
        .locator('.ProseMirror')
        .first();
    await expect(rich).toContainText('Keep bold');
    await expect(rich.locator('strong')).toHaveText('Keep bold');
    await expect(rich.locator('ul li')).toContainText('Keep list');
    await rich.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Edited');
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('--- ');
    await expect(rich.locator('hr')).toHaveCount(1);
    await openRichLink(page, rich);
    const linkDialog = page.getByRole('dialog', {
        name: '编辑链接',
        exact: true,
    });
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await linkDialog
        .getByLabel('URL', { exact: true })
        .fill('https://example.test/b6-edited');
    await linkDialog.getByRole('button', { name: '更新', exact: true }).click();
    const mediaField = page.locator(
        `[data-bcms-prop-input-wrapper][id="${id.paths.MEDIA}"]`,
    );
    await mediaField.locator('button').first().click();
    const mediaDialog = page.getByRole('dialog', {
        name: '媒体选择器',
        exact: true,
    });
    await expect(mediaDialog.locator('.cms-modal-panel')).toBeVisible();
    await mediaDialog
        .locator('[bcms-media-data]')
        .filter({ has: page.locator('img[alt="B4 own image.png"]') })
        .first()
        .locator('..')
        .click();
    await mediaDialog
        .getByRole('button', { name: '完成', exact: true })
        .click();
    const referenceField = page.locator(
        `[data-bcms-prop-input-wrapper][id="${id.paths.ENTRY_POINTER}"]`,
    );
    await referenceField.locator('.cms-select-trigger').first().click();
    await page.getByRole('option').filter({ hasText: id.relatedTitle }).click();
    const tags = page.locator(`[id="${id.paths.STRING}"]`).first();
    const tagInputs = tags.locator('[contenteditable="true"]');
    await expect(tagInputs).toHaveCount(3);
    await tagInputs.nth(1).fill('middle edited');
    await tags
        .getByRole('button', { name: '下移此项', exact: true })
        .first()
        .click();
    const widgetInput = page
        .locator('.studio-structured-field[data-field]')
        .filter({ has: page.locator('legend') })
        .locator('[contenteditable="true"]')
        .first();
    await widgetInput.fill('Widget edited');
    const grouped = page
        .locator(
            `[data-bcms-prop-input-wrapper][id="${id.paths.GROUP_POINTER}"]`,
        )
        .locator('[contenteditable="true"]');
    await expect(grouped).toHaveCount(2);
    await grouped.first().fill('Nested edited');
    const writes = [];
    page.on('request', (r) => {
        if (r.method() === 'PUT' && r.url().endsWith('/entry/update'))
            writes.push(r);
    });
    await expect(
        page.locator('textarea[aria-label="区块属性 JSON"]'),
    ).toHaveCount(0);
    expect(writes).toHaveLength(0);
    const saved = page.waitForResponse(
        (r) =>
            r.request().method() === 'PUT' && r.url().endsWith('/entry/update'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    expect((await saved).status()).toBe(200);
    const after = await page.evaluate(
        async (id) =>
            window.bcms.sdk.entry.get({
                templateId: id.templateId,
                entryId: id.entryId,
                skipCache: true,
            }),
        id,
    );
    const beforeMeta = id.original.meta.find((m) => m.lng === id.language);
    const afterMeta = after.meta.find((m) => m.lng === id.language);
    const unchanged = (type) => {
        const index = Number(id.paths[type].split('.').at(-1));
        return [beforeMeta.props[index], afterMeta.props[index]];
    };
    expect(unchanged('MEDIA')[1].data[0]._id).toBe(
        process.env.STOREFRONT_E2E_OWN_MEDIA,
    );
    expect(unchanged('ENTRY_POINTER')[1].data[0].eid).toBe(id.relatedId);
    expect(after.meta.find((m) => m.lng === id.other)).toEqual(
        id.original.meta.find((m) => m.lng === id.other),
    );
    expect(after.content).toEqual(id.original.content);
    const groupData = unchanged('GROUP_POINTER')[1].data;
    expect(groupData.items[0].props[0].data.props[0].data).toEqual([
        'Nested edited',
    ]);
    expect(groupData.items[1]).toEqual(
        unchanged('GROUP_POINTER')[0].data.items[1],
    );
    await page.reload();
    await expect(rich).toContainText('Edited');
    await expect(rich.locator('strong')).toHaveText('Keep bold');
    await expect(rich.locator('a')).toHaveAttribute(
        'href',
        'https://example.test/b6-edited',
    );
    await expect(rich.locator('hr')).toHaveCount(1);
    await expect(tagInputs.nth(0)).toHaveText('middle edited');
    await expect(widgetInput).toHaveText('Widget edited');
    await page.evaluate(async (id) => {
        const sdk = window.bcms.sdk;
        const e = await sdk.entry.get({
            templateId: id.templateId,
            entryId: id.entryId,
            skipCache: true,
        });
        await sdk.entry.update({
            _id: e._id,
            templateId: e.templateId,
            expectedUpdatedAt: e.updatedAt,
            lng: id.language,
            meta: e.meta.find((m) => m.lng === id.language),
            content: e.content.find((m) => m.lng === id.language),
        });
    }, id);
    await rich.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Local conflict');
    const conflict = page.waitForResponse(
        (r) =>
            r.request().method() === 'PUT' && r.url().endsWith('/entry/update'),
    );
    const selectionBefore = await rich.evaluate((el) => ({
        anchor: getSelection()?.anchorOffset,
        text: getSelection()?.anchorNode?.textContent,
        focused: document.activeElement === el,
    }));
    await page.evaluate(() =>
        document.querySelector('#studio-entry-form').requestSubmit(),
    );
    expect((await conflict).status()).toBe(409);
    await expect(rich).toContainText('Local conflict');
    await expect(rich).toBeFocused();
    expect(
        await rich.evaluate((el) => ({
            anchor: getSelection()?.anchorOffset,
            text: getSelection()?.anchorNode?.textContent,
            focused: document.activeElement === el,
        })),
    ).toEqual(selectionBefore);
    let releaseConflict;
    const heldConflict = new Promise((resolve) => {
        releaseConflict = resolve;
    });
    await page.route(
        '**/entry/update',
        async (route) => {
            await heldConflict;
            await route.continue();
        },
        { times: 1 },
    );
    await rich.focus();
    const delayedRequest = page.waitForRequest(
        (request) =>
            request.method() === 'PUT' &&
            request.url().endsWith('/entry/update'),
    );
    await page.evaluate(() =>
        document.querySelector('#studio-entry-form').requestSubmit(),
    );
    await delayedRequest;
    const shellFocus = page.getByRole('link', {
        name: '发布更新',
        exact: true,
    });
    await shellFocus.focus();
    const delayedResponse = page.waitForResponse(
        (response) =>
            response.request().method() === 'PUT' &&
            response.url().endsWith('/entry/update'),
    );
    releaseConflict();
    expect((await delayedResponse).status()).toBe(409);
    await expect(
        page.getByRole('button', { name: '保存草稿', exact: true }),
    ).toBeEnabled();
    await expect(shellFocus).toBeFocused();
    await page.screenshot({
        path: info.outputPath('structured-workspace.png'),
        mask: [
            page.getByText(process.env.STOREFRONT_E2E_EMAIL, { exact: false }),
        ],
    });
});

test('declared section rich text edits nodes in place, saves and reloads in the same canvas', async ({
    page,
    installation,
}, info) => {
    const id = await installed(page);
    const target = await page.evaluate(async () => {
        const state = await window.bcms.sdk.studio.getSite();
        const page = state.site.pages.find((p) =>
            p.layoutDocument?.root.some(
                (n) =>
                    state.site.editorContract.sections.find(
                        (s) => s.type === n.type,
                    )?.props.body?.control === 'rich-text',
            ),
        );
        const node = page.layoutDocument.root.find(
            (n) =>
                state.site.editorContract.sections.find(
                    (s) => s.type === n.type,
                )?.props.body?.control === 'rich-text',
        );
        return { key: page.key, nodeId: node.id };
    });
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({ section: 'pages', pageKey: target.key }),
    );
    await expect(workspace(page)).toHaveCount(1);
    await page
        .locator('.studio-visual-node-button')
        .filter({ hasText: /商品详情|品牌故事/ })
        .first()
        .click();
    const rich = page.locator(`#section-${target.nodeId}-body .ProseMirror`);
    await expect(rich).toBeVisible();
    const sectionText = 'Section rich bold ' + info.project.name;
    await rich.fill(sectionText);
    await rich.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
    });
    if (!(await rich.locator('strong').count()))
        await page.locator('div[style*="opacity: 1"] #bold').click();
    await expect(rich.locator('strong')).toContainText('Section rich bold');
    const saved = page.waitForResponse(
        (r) =>
            r.request().method() === 'POST' &&
            r.url().includes('/studio/pages/'),
    );
    await page
        .getByRole('button', { name: '保存页面设置', exact: true })
        .click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await page
        .locator('.studio-visual-node-button')
        .filter({ hasText: /商品详情|品牌故事/ })
        .first()
        .click();
    await expect(rich).toContainText('Section rich bold');
    expect(
        await page.evaluate(async (target) => {
            const state = await window.bcms.sdk.studio.getSite();
            const body = state.site.pages
                .find((p) => p.key === target.key)
                .layoutDocument.root.find((n) => n.id === target.nodeId)
                .props.body;
            return body.nodes.some((n) =>
                n.content?.some((t) => t.marks?.some((m) => m.type === 'bold')),
            );
        }, target),
    ).toBe(true);
    await expect(page.locator('.studio-visual-preview iframe')).toHaveCount(1);
});

test('semantic rich links and nested widgets reject other-site resources on every adopted HTTP path', async ({
    page,
    installation,
}) => {
    const result = await page.evaluate(
        async ({ ownMedia, foreignMedia }) => {
            const sdk = window.bcms.sdk;
            let state = await sdk.studio.getSite();
            const model = state.models.find((m) => m.key === 'content-page');
            const template = await sdk.template.get({
                templateId: model.templateId,
            });
            const richId = template.props.find(
                (p) => p.type === 'RICH_TEXT',
            ).id;
            const otherSite = await sdk.send({
                url: '/api/v4/workspaces/current/sites',
                method: 'POST',
                data: { name: 'B6 linked site' },
            });
            const selectorOverride = {
                workspaceId: sdk.context.context.workspaceId,
                siteId: otherSite._id,
            };
            await sdk.send({
                url: '/api/v4/presets/import',
                method: 'POST',
                data: {
                    presetId: 'aeroframe',
                    siteName: 'B6 linked site',
                    includeDemo: true,
                },
                selectorOverride,
            });
            const other = await sdk.send({
                url: '/api/v4/studio/site',
                selectorOverride,
            });
            const foreignModel = other.models.find((m) => m.key === 'product');
            let widget = await sdk.widget.create({
                label: 'B6 image ' + crypto.randomUUID().slice(0, 8),
                desc: '',
            });
            widget = await sdk.widget.update({
                _id: widget._id,
                propChanges: [
                    {
                        add: {
                            label: 'Image',
                            type: 'MEDIA',
                            required: false,
                            array: false,
                            data: {},
                        },
                    },
                ],
            });
            const get = () =>
                sdk.entry.get({
                    templateId: model.templateId,
                    entryId: model.entries[0].id,
                    skipCache: true,
                });
            const status = async (fn) => {
                try {
                    await fn();
                    return 200;
                } catch (e) {
                    return e.response?.status || e.status || 0;
                }
            };
            const link = (href) => [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Linked resource',
                            marks: [
                                {
                                    type: 'link',
                                    attrs: { href, target: '_self' },
                                },
                            ],
                        },
                    ],
                },
            ];
            const mediaWidget = (media) => [
                {
                    type: 'widget',
                    attrs: {
                        data: {
                            _id: widget._id,
                            props: [
                                {
                                    id: widget.props[0].id,
                                    data: [{ _id: media }],
                                },
                            ],
                        },
                    },
                },
            ];
            const badNodes = [
                link(`media:${foreignMedia}@*_@*_:media`),
                link(
                    `entry:${foreignModel.entries[0].id}@*_${foreignModel.templateId}:entry`,
                ),
                mediaWidget(foreignMedia),
            ];
            const original = await get();
            const originalState = await sdk.studio.getSite();
            const denied = [];
            for (const nodes of badNodes) {
                const raw = await get();
                const meta = structuredClone(
                    raw.meta.find((m) => m.lng === state.site.language),
                );
                meta.props.find((p) => p.id === richId).data = [{ nodes }];
                const update = () =>
                    sdk.entry.update({
                        _id: raw._id,
                        templateId: raw.templateId,
                        expectedUpdatedAt: raw.updatedAt,
                        lng: state.site.language,
                        meta,
                        content: raw.content.find(
                            (c) => c.lng === state.site.language,
                        ),
                    });
                const suffix = crypto.randomUUID().slice(0, 8);
                const createMeta = structuredClone(meta);
                createMeta.props[0].data = ['B6 link ' + suffix];
                createMeta.props[1].data = ['b6-link-' + suffix];
                const create = () =>
                    sdk.entry.create({
                        templateId: raw.templateId,
                        data: {
                            statuses: [],
                            meta: [createMeta],
                            content: [{ lng: state.site.language, nodes: [] }],
                        },
                    });
                const studio = () =>
                    sdk.studio.saveEntry(model.key, {
                        entryId: raw._id,
                        expectedUpdatedAt: raw.updatedAt,
                        operationId: crypto.randomUUID(),
                        fields: {
                            body: { kind: 'prop-data', data: [{ nodes }] },
                        },
                    });
                state = await sdk.studio.getSite();
                const p = state.site.pages.find((p) =>
                    p.layoutDocument?.root.some(
                        (n) =>
                            state.site.editorContract.sections.find(
                                (s) => s.type === n.type,
                            )?.props.body?.control === 'rich-text',
                    ),
                );
                const layoutDocument = structuredClone(p.layoutDocument);
                layoutDocument.root.find(
                    (n) =>
                        state.site.editorContract.sections.find(
                            (s) => s.type === n.type,
                        )?.props.body?.control === 'rich-text',
                ).props.body = { nodes };
                const section = () =>
                    sdk.studio.savePage(p.key, {
                        expectedUpdatedAt: state.site.updatedAt,
                        title: p.title,
                        path: p.path,
                        seoTitle: p.seoTitle,
                        seoDescription: p.seoDescription,
                        sections: p.sections,
                        layoutDocument,
                        entryId: p.entryId,
                        enabled: p.enabled,
                        navigation: p.navigation,
                    });
                denied.push(
                    await status(update),
                    await status(create),
                    await status(studio),
                    await status(section),
                );
            }
            // A full page create must authorize every submitted translation.
            const alternate = state.site.language === 'fr' ? 'de' : 'fr';
            if (
                !(await sdk.language.getAll()).some(
                    (item) => item.code === alternate,
                )
            )
                await sdk.language.create({
                    code: alternate,
                    name: alternate,
                    nativeName: alternate,
                });
            const translated = structuredClone(
                original.meta.find((item) => item.lng === state.site.language),
            );
            const pageSuffix = crypto.randomUUID().slice(0, 8);
            translated.lng = alternate;
            translated.props[0].data = ['B6 translated ' + pageSuffix];
            translated.props[1].data = ['b6-translated-' + pageSuffix];
            translated.props.find((item) => item.id === richId).data = [
                { nodes: badNodes[0] },
            ];
            const currentMeta = structuredClone(
                original.meta.find((item) => item.lng === state.site.language),
            );
            currentMeta.props[0].data = ['B6 page ' + pageSuffix];
            currentMeta.props[1].data = ['b6-page-' + pageSuffix];
            const blueprint = state.site.pages.find(
                (item) => item.layout === 'content-page' && !item.blueprintKey,
            );
            denied.push(
                await status(() =>
                    sdk.studio.createPage({
                        operationId: crypto.randomUUID(),
                        expectedUpdatedAt: state.site.updatedAt,
                        title: 'B6 translated page',
                        path: '/pages/b6-translated-' + pageSuffix,
                        blueprintKey: blueprint.key,
                        entry: {
                            statuses: [],
                            meta: [currentMeta, translated],
                            content: [
                                { lng: currentMeta.lng, nodes: [] },
                                { lng: alternate, nodes: [] },
                            ],
                        },
                    }),
                ),
            );
            const current = await get();
            const after = await sdk.studio.getSite();
            const unchanged =
                JSON.stringify(current) === JSON.stringify(original) &&
                after.site.updatedAt === originalState.site.updatedAt &&
                after.models.find((m) => m.key === model.key).entries.length ===
                    originalState.models.find((m) => m.key === model.key)
                        .entries.length;
            const controls = [];
            for (const nodes of [
                link(`media:${ownMedia}@*_@*_:media`),
                link(`entry:${original._id}@*_${template._id}:entry`),
                mediaWidget(ownMedia),
            ]) {
                const latest = await get();
                controls.push(
                    await status(() =>
                        sdk.studio.saveEntry(model.key, {
                            entryId: latest._id,
                            expectedUpdatedAt: latest.updatedAt,
                            operationId: crypto.randomUUID(),
                            fields: {
                                body: { kind: 'prop-data', data: [{ nodes }] },
                            },
                        }),
                    ),
                );
            }
            return { denied, unchanged, controls };
        },
        {
            ownMedia: process.env.STOREFRONT_E2E_OWN_MEDIA,
            foreignMedia: process.env.STOREFRONT_E2E_FOREIGN_MEDIA,
        },
    );
    expect(result.denied.every((status) => [400, 403].includes(status))).toBe(
        true,
    );
    expect(result.denied).toHaveLength(13);
    expect(result.unchanged).toBe(true);
    expect(result.controls).toEqual([200, 200, 200]);
});

test('rich link media picker carries bound-site candidates and rejects retired owner confirmation', async ({
    page,
    installation,
    isMobile,
}) => {
    test.setTimeout(60000);
    const id = await installed(page);
    await page.evaluate(async (id) => {
        const sdk = window.bcms.sdk;
        const raw = await sdk.entry.get({
            templateId: id.templateId,
            entryId: id.entryId,
            skipCache: true,
        });
        await sdk.studio.saveEntry(id.modelKey, {
            entryId: id.entryId,
            expectedUpdatedAt: raw.updatedAt,
            operationId: crypto.randomUUID(),
            fields: {
                body: {
                    kind: 'prop-data',
                    data: [
                        {
                            nodes: [
                                {
                                    type: 'paragraph',
                                    content: [
                                        {
                                            type: 'text',
                                            text: 'Bound link',
                                            marks: [
                                                {
                                                    type: 'link',
                                                    attrs: {
                                                        href: '/',
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
            },
        });
    }, id);
    await page.goto('/d/studio?section=content&modelKey=content-page');
    await page.locator('.studio-row-action').first().click();
    await expect(workspace(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp('entryId=' + id.entryId));
    const rich = page
        .locator(
            '.studio-structured-field .bcmsEntryContentEditor .ProseMirror',
        )
        .first();
    await page.evaluate(() => {
        const handler = window.bcms.sdk.entry;
        const original = handler.getAllLite;
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        handler.getAllLite = async (...args) => {
            const result = await original.apply(handler, args);
            await gate;
            return result;
        };
        window.b6ReleaseLinkCandidates = async () => {
            release();
            handler.getAllLite = original;
            await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
        };
    });
    await openRichLink(page, rich, true);
    const linkDialog = page.getByRole('dialog', {
        name: '编辑链接',
        exact: true,
    });
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await linkDialog
        .getByLabel('链接类型', { exact: true })
        .selectOption('media');
    await page.evaluate(() => window.b6ReleaseLinkCandidates());
    await expect(
        linkDialog.getByLabel('链接类型', { exact: true }),
    ).toHaveValue('media');

    await linkDialog
        .getByRole('button', { name: '点击选择媒体文件', exact: true })
        .click();
    const mediaDialog = page.getByRole('dialog', {
        name: '媒体选择器',
        exact: true,
    });
    await expect(mediaDialog.locator('.cms-modal-panel')).toBeVisible();
    await expect(
        mediaDialog
            .locator('[bcms-media-data]')
            .filter({ has: page.locator('img[alt="B4 own image.png"]') }),
    ).toHaveCount(1);
    // Escape retires only the foreground picker and returns to the link draft.
    await page.keyboard.press('Escape');
    await expect(mediaDialog).toHaveCount(0);
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await expect(
        linkDialog.getByLabel('链接类型', { exact: true }),
    ).toHaveValue('media');
    await expect(
        linkDialog.getByRole('button', {
            name: '点击选择媒体文件',
            exact: true,
        }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(mediaDialog.locator('.cms-modal-panel')).toBeVisible();
    const backdrop = mediaDialog.locator('.cms-modal-position');
    if (isMobile) await backdrop.tap({ position: { x: 5, y: 5 } });
    else await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(mediaDialog).toHaveCount(0);
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await expect(
        linkDialog.getByLabel('链接类型', { exact: true }),
    ).toHaveValue('media');
    await linkDialog
        .getByRole('button', { name: '点击选择媒体文件', exact: true })
        .click();
    await mediaDialog
        .getByRole('button', { name: '取消', exact: true })
        .click();
    await expect(mediaDialog).toHaveCount(0);
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await linkDialog
        .getByRole('button', { name: '点击选择媒体文件', exact: true })
        .click();
    await expect(mediaDialog.locator('.cms-modal-panel')).toBeVisible();
    await expect(
        mediaDialog
            .locator('[bcms-media-data]')
            .filter({ has: page.locator('img[alt="B4 foreign image.png"]') }),
    ).toHaveCount(0);
    await mediaDialog
        .locator('[bcms-media-data]')
        .filter({ has: page.locator('img[alt="B4 own image.png"]') })
        .first()
        .locator('..')
        .click();
    await mediaDialog
        .getByRole('button', { name: '完成', exact: true })
        .click();
    await expect(mediaDialog).toHaveCount(0);
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    await expect
        .poll(() =>
            linkDialog.evaluate((el) => el.contains(document.activeElement)),
        )
        .toBe(true);
    await linkDialog.getByRole('button', { name: '更新', exact: true }).click();
    const before = await rich.locator('a').getAttribute('href');
    expect(before).toBe(
        `media:${process.env.STOREFRONT_E2E_OWN_MEDIA}@*_@*_:media`,
    );
    // Let the two dialogs' focus restoration finish before selecting a new plain word.
    await expect(linkDialog).toHaveCount(0);
    await page.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
    );
    // A new plain selection isolates owner retirement from reselecting the same link mark.
    await rich.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const lifecycleText = 'Lifecycle selection';
    await page.keyboard.type(lifecycleText);
    await expect(rich).toContainText(lifecycleText);
    await page.keyboard.down('Shift');
    for (let index = 0; index < lifecycleText.length; index++)
        await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    await expect(page.locator('div[style*="opacity: 1"] #link')).toHaveCount(1);
    await page.locator('div[style*="opacity: 1"] #link').click();
    await expect(linkDialog.locator('.cms-modal-panel')).toBeVisible();
    const beforeRetired = await rich.innerHTML();
    const retired = await page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const previous = sdk.context;
        sdk.context = null;
        try {
            return (
                await window.bcms.modalService.handlers.entryContentLinkEdit._onDone()
            )[0];
        } finally {
            sdk.context = previous;
        }
    });
    expect(retired).toBe(false);
    expect(await rich.innerHTML()).toBe(beforeRetired);
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toMatch(/尚未保存/);
        await dialog.accept();
    });
    await page.goBack();
    await expect(linkDialog).toHaveCount(0);
    await expect(mediaDialog).toHaveCount(0);
});

test('the real controlled rich editor adopts same-array external nodes and preserves selection on unrelated renders', async ({
    page,
}) => {
    const server = await controlledRichEditorHarness();
    try {
        await page.goto(server.url);
        const rich = page.locator('.ProseMirror');
        await expect(rich).toContainText('Initial controlled content');
        await rich.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type(' edited');
        const before = await rich.evaluate(() => ({
            offset: getSelection().anchorOffset,
            text: getSelection().anchorNode.textContent,
        }));
        await page.evaluate(() => {
            window.editorState.unrelated = 'unrelated-render';
        });
        await expect(rich).toBeFocused();
        expect(
            await rich.evaluate(() => ({
                offset: getSelection().anchorOffset,
                text: getSelection().anchorNode.textContent,
            })),
        ).toEqual(before);
        await page.evaluate(() => {
            window.editorState.nodes[0].content[0].text =
                'External same-array update';
        });
        await expect(rich).toContainText('External same-array update');
        await page.evaluate(() => {
            window.editorState.disabled = true;
        });
        await expect(rich).toHaveAttribute('contenteditable', 'false');
        await page.evaluate(() => {
            window.editorState.disabled = false;
        });
        await expect(rich).toHaveAttribute('contenteditable', 'true');
    } finally {
        await server.close();
    }
});
