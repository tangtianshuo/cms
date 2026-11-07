import { expect } from '@playwright/test';
import { workspace, save } from './launch-workspace.mjs';
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

async function structuredFixture(page) {
    // Infrastructure only: schemas and language definitions; content is authored below.
    return page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const suffix = crypto.randomUUID().slice(0, 8);
        const reference = await sdk.template.create({
            label: 'D1 reference ' + suffix,
            desc: '',
            singleEntry: false,
        });
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
                                    templateId: reference._id,
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
        const language = state.site.language;
        const other = language === 'fr' ? 'de' : 'fr';
        if (!(await sdk.language.getAll()).some((l) => l.code === other))
            await sdk.language.create({
                code: other,
                name: other,
                nativeName: other,
            });
        const languages = await sdk.language.getAll();
        return {
            templateId: template._id,
            language,
            languageIndex: languages.findIndex((l) => l.code === language),
            workspaceId: sdk.context.context.workspaceId,
            other,
            referenceTemplateId: reference._id,
            title: 'D1 structured ' + suffix,
            relatedTitle: 'B6 referenced ' + suffix,
            paths: Object.fromEntries(
                template.props.map((p, i) => [
                    p.type,
                    `entry.meta.${languages.findIndex((l) => l.code === language)}.props.${i}`,
                ]),
            ),
        };
    });
}

export async function editStructured(page, { ownMedia, filename }) {
    const id = await structuredFixture(page);
    const open = async (
        templateId,
        entryId = 'create',
        language = id.language,
    ) => {
        await page.goto(
            '/d/studio?' +
                new URLSearchParams({
                    section: 'content',
                    templateId,
                    entryId,
                    language,
                    workspaceId: id.workspaceId,
                }),
        );
        await expect(workspace(page)).toHaveCount(1);
    };
    const title = () =>
        page
            .locator('.studio-workspace-content [contenteditable="true"]')
            .first();
    const saveCreated = async () => {
        const response = page.waitForResponse(
            (r) =>
                r.request().method() === 'POST' &&
                r.url().endsWith('/entry/create'),
        );
        await page
            .getByRole('button', { name: '保存草稿', exact: true })
            .click();
        const createdResponse = await response;
        expect(createdResponse.status()).toBe(200);
        const created = (await createdResponse.json()).item;
        expect(created._id).toBeTruthy();
        await expect
            .poll(() => new URL(page.url()).searchParams.get('entryId'))
            .not.toBe('create');
        expect(new URL(page.url()).searchParams.get('entryId')).toBe(
            created._id,
        );
        expect(new URL(page.url()).searchParams.get('templateId')).toBe(
            created.templateId,
        );
        const persisted = await page.evaluate(
            async (created) =>
                window.bcms.sdk.entry.get({
                    templateId: created.templateId,
                    entryId: created._id,
                    skipCache: true,
                }),
            created,
        );
        expect(persisted.updatedAt).toBe(created.updatedAt);
        expect(persisted.meta).toEqual(created.meta);
        expect(persisted.content).toEqual(created.content);
        await expect(
            page.getByRole('button', { name: '保存草稿', exact: true }),
        ).toBeDisabled();
    };

    await open(id.referenceTemplateId);
    await title().fill(id.relatedTitle);
    await saveCreated();
    id.relatedId = new URL(page.url()).searchParams.get('entryId');
    expect(id.relatedId).not.toBe('create');
    await open(id.templateId);
    await title().fill(id.title);
    const rich = page
        .locator('.studio-structured-field[data-field]')
        .filter({ has: page.locator('.bcmsEntryContentEditor') })
        .locator('.ProseMirror')
        .first();
    await rich.focus();
    await page.keyboard.type('**Keep bold** ');
    await page.keyboard.press('Enter');
    await page.keyboard.type('* Keep list');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('link');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
    await page.locator('div[style*="opacity: 1"] #link').click();
    const initialLink = page.getByRole('dialog', {
        name: '编辑链接',
        exact: true,
    });
    await initialLink
        .getByLabel('URL', { exact: true })
        .fill('https://example.test/original');
    await initialLink
        .getByRole('button', { name: '更新', exact: true })
        .click();
    const initialTags = page.locator(`[id="${id.paths.STRING}"]`).first();
    for (const value of ['first', 'second', 'third']) {
        await initialTags
            .getByRole('button', { name: /Ordered tags.*添加/ })
            .click();
        await initialTags
            .locator('[contenteditable="true"]')
            .last()
            .fill(value);
    }
    const initialWidget = page
        .locator('.studio-structured-field[data-field]')
        .filter({ has: page.locator('legend') })
        .locator('[contenteditable="true"]')
        .first();
    await initialWidget.fill('Widget before');
    const initialGroup = page.locator(
        `[data-bcms-prop-input-wrapper][id="${id.paths.GROUP_POINTER}"]`,
    );
    for (const value of ['Nested before', 'Sibling preserved']) {
        await initialGroup
            .getByRole('button', { name: /Grouped widgets.*添加/ })
            .click();
        await initialGroup
            .locator('[contenteditable="true"]')
            .last()
            .fill(value);
    }
    await page
        .locator(`[id="entry.content.${id.languageIndex}.nodes"] .ProseMirror`)
        .fill('Main body preserved');
    await saveCreated();
    id.entryId = new URL(page.url()).searchParams.get('entryId');
    expect(id.entryId).not.toBe('create');
    await open(id.templateId, id.entryId, id.other);
    await page
        .getByRole('button', { name: '创建此语言版本', exact: true })
        .click();
    await title().fill('Other ' + id.title);
    await save(page);
    await open(id.templateId, id.entryId);
    id.original = await page.evaluate(
        async (id) =>
            window.bcms.sdk.entry.get({
                templateId: id.templateId,
                entryId: id.entryId,
                skipCache: true,
            }),
        id,
    );
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
    expect(JSON.stringify(after.content)).toContain('Main body preserved');
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
    await page.goto('/d/studio?section=content&modelKey=content-page');
    await page.locator('.studio-row-action').first().click();
    await expect(workspace(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp('entryId=' + id.entryId));
    const rich = page
        .locator(
            '.studio-structured-field .bcmsEntryContentEditor .ProseMirror',
        )
        .first();
    await rich.fill('Bound link');
    await openRichLink(page, rich, true);
    const authoredLink = page.getByRole('dialog', {
        name: '编辑链接',
        exact: true,
    });
    await authoredLink
        .getByLabel('URL', { exact: true })
        .fill('https://example.test/bound');
    await authoredLink
        .getByRole('button', { name: '更新', exact: true })
        .click();
    await save(page);
    await page.reload();
    await expect(rich.locator('a')).toHaveAttribute(
        'href',
        'https://example.test/bound',
    );
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
