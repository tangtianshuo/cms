import { expect } from '@playwright/test';
import { workspace } from './launch-workspace.mjs';
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

async function structuredFixture(page, ownMedia) {
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
                                            href: '/',
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
    }, ownMedia);
}

export async function editStructured(page, { ownMedia, filename }) {
    const id = await structuredFixture(page, ownMedia);
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
        .filter({ has: page.getByAltText(filename, { exact: true }) })
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
    expect(unchanged('MEDIA')[1].data[0]._id).toBe(ownMedia);
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
}
export async function retireRichEditor(page, { ownMedia, filename }) {
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
            .filter({ has: page.getByAltText(filename, { exact: true }) }),
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
    await backdrop.click({ position: { x: 5, y: 5 } });
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
    await mediaDialog
        .locator('[bcms-media-data]')
        .filter({ has: page.getByAltText(filename, { exact: true }) })
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
    expect(before).toBe(`media:${ownMedia}@*_@*_:media`);
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
}
