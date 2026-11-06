import { test, expect } from './browser-fixture.mjs';

const workspace = (page) =>
    page.getByRole('region', { name: '内容编辑工作区', exact: true });
const title = (page) =>
    page.locator('.studio-workspace-content [contenteditable="true"]').first();
async function navigate(page, location) {
    await page.evaluate(
        (location) =>
            document
                .querySelector('#bcms-app')
                .__vue_app__.config.globalProperties.$router.push(location),
        location,
    );
}
async function fixture(page) {
    return page.evaluate(async () => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((item) => item.key === 'content-page');
        return {
            workspaceId: sdk.context.context.workspaceId,
            siteId: state.site.id,
            templateId: model.templateId,
            modelKey: model.key,
            entryId: model.entries[0].id,
            language: state.site.language,
        };
    });
}
const location = (id, extra = {}) =>
    '/d/studio?' + new URLSearchParams({ section: 'content', ...id, ...extra });

test('B5 review singleton sidebar home and brand use strict template targets', async ({
    page,
    installation,
}, info) => {
    const models = await page.evaluate(async () =>
        (await window.bcms.sdk.studio.getSite()).models
            .filter((model) => ['home', 'site-settings'].includes(model.key))
            .map((model) => ({
                key: model.key,
                templateId: model.templateId,
                entryId: model.entries[0].id,
            })),
    );
    expect(models).toHaveLength(2);
    for (const model of models) {
        await page.goto('/d/studio');
        if (info.project.name === 'mobile')
            await page
                .getByRole('button', { name: '展开导航', exact: true })
                .click();
        await page
            .locator('summary:visible')
            .filter({ hasText: '网站内容分类' })
            .click();
        const link = page
            .getByRole('navigation', { name: '网站内容模型', exact: true })
            .locator(`a[href*="${model.templateId}"]`);
        await link.click();
        await expect(workspace(page)).toHaveCount(1);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(
            page.getByLabel('内容语言', { exact: true }),
        ).toBeVisible();
        expect(await title(page).textContent()).toBeTruthy();
        await navigate(
            page,
            location(await fixture(page), {
                templateId: model.templateId,
                modelKey: 'product',
                entryId: model.entryId,
            }),
        );
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(workspace(page)).toHaveCount(0);
    }
});

test('B5 review acknowledged page rebind transitions editor and next save to B with navigation retry', async ({
    page,
    installation,
}) => {
    const id = await fixture(page);
    const data = await page.evaluate(async (id) => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const raw = await sdk.entry.get({
            templateId: id.templateId,
            entryId: id.entryId,
            skipCache: true,
        });
        const meta = structuredClone(raw.meta);
        const bTitle = 'B5 rebind B ' + crypto.randomUUID().slice(0, 8);
        for (const item of meta) {
            item.props[0].data = [bTitle];
            item.props[1].data = [
                'b5-rebind-' + crypto.randomUUID().slice(0, 8),
            ];
        }
        let b;
        try {
            b = await sdk.entry.create({
                templateId: id.templateId,
                data: {
                    meta,
                    content: raw.content,
                    statuses: raw.statuses,
                    groupId: raw.groupId,
                },
            });
        } catch (error) {
            throw new Error('B fixture create: ' + JSON.stringify(error));
        }
        const blueprint = state.site.blueprints.find(
            (item) => item.modelKey === id.modelKey,
        );
        for (const item of raw.meta) {
            item.props[0].data = [
                'B5 rebind A ' + crypto.randomUUID().slice(0, 8),
            ];
            item.props[1].data = [
                'b5-rebind-a-' + crypto.randomUUID().slice(0, 8),
            ];
        }
        let page;
        try {
            page = await sdk.studio.createPage({
                operationId: crypto.randomUUID(),
                expectedUpdatedAt: state.site.updatedAt,
                title: 'B5 rebind page',
                path: '/pages/b5-rebind-' + crypto.randomUUID().slice(0, 8),
                blueprintKey: blueprint.key,
                entry: {
                    meta: raw.meta,
                    content: raw.content,
                    statuses: raw.statuses,
                    groupId: raw.groupId,
                },
            });
        } catch (error) {
            throw new Error('A page fixture create: ' + JSON.stringify(error));
        }
        return { a: page.entryId, b: b._id, bTitle, pageKey: page.key };
    }, id);
    await navigate(
        page,
        location(id, { entryId: data.a, pageKey: data.pageKey, panel: 'page' }),
    );
    await expect(page.getByLabel(/^绑定内容/)).toBeVisible();
    await page.getByLabel(/^绑定内容/).selectOption(data.b);
    const saved = page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname.includes('/studio/pages/'),
    );
    await page
        .getByRole('button', { name: '保存页面设置', exact: true })
        .click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp('entryId=' + data.b));
    await page.getByRole('tab', { name: '页面内容', exact: true }).click();
    await expect(title(page)).toHaveText(data.bTitle);
    const savedTitle = 'B5 saved through B ' + data.b;
    await title(page).fill(savedTitle);
    const updated = page.waitForResponse(
        (response) =>
            response.request().method() === 'PUT' &&
            new URL(response.url()).pathname.endsWith('/entry/update'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    const response = await updated;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()._id).toBe(data.b);
    expect(
        await page.evaluate(
            async ({ id, data, savedTitle }) => {
                const sdk = window.bcms.sdk;
                const a = await sdk.entry.get({
                    templateId: id.templateId,
                    entryId: data.a,
                    skipCache: true,
                });
                const b = await sdk.entry.get({
                    templateId: id.templateId,
                    entryId: data.b,
                    skipCache: true,
                });
                return (
                    a.meta.find((item) => item.lng === id.language).props[0]
                        .data[0] !== savedTitle &&
                    b.meta.find((item) => item.lng === id.language).props[0]
                        .data[0] === savedTitle
                );
            },
            { id, data, savedTitle },
        ),
    ).toBe(true);
    await page.getByRole('tab', { name: '页面信息', exact: true }).click();
    await page.getByLabel(/^绑定内容/).selectOption(data.a);
    await page.evaluate(() => {
        const router =
            document.querySelector('#bcms-app').__vue_app__.config
                .globalProperties.$router;
        const remove = router.beforeEach((to) => {
            if (to.query.entryId) {
                remove();
                return false;
            }
        });
    });
    await page
        .getByRole('button', { name: '保存页面设置', exact: true })
        .click();
    await expect(page.getByRole('alert')).toContainText('绑定');
    await expect(page.locator('.studio-success')).toHaveCount(0);
    expect(
        await page.evaluate(
            async (data) =>
                (await window.bcms.sdk.studio.getSite()).site.pages.find(
                    (item) => item.key === data.pageKey,
                ).entryId,
            data,
        ),
    ).toBe(data.a);
    await expect(page.locator('#studio-page-form')).toHaveAttribute(
        'inert',
        '',
    );
    await expect(
        page.getByRole('button', { name: '保存页面设置', exact: true }),
    ).toBeDisabled();
    await page
        .getByRole('button', { name: '重新打开绑定内容', exact: true })
        .click();
    await expect(page).toHaveURL(new RegExp('entryId=' + data.a));
    await page.getByRole('tab', { name: '页面内容', exact: true }).click();
    await expect(page.getByLabel('内容语言', { exact: true })).toBeVisible();
});

test('B5 review retired workspace loader cannot change a newer language or save identity', async ({
    page,
    installation,
}) => {
    const id = await fixture(page);
    const language = id.language === 'fr' ? 'de' : 'fr';
    const newerTitle =
        'B5 newer translation ' + crypto.randomUUID().slice(0, 8);
    const savedTitle = newerTitle + ' saved';
    await page.evaluate(
        async ({ id, language, newerTitle }) => {
            const sdk = window.bcms.sdk;
            if (
                !(await sdk.language.getAll()).some(
                    (item) => item.code === language,
                )
            )
                await sdk.language.create({
                    code: language,
                    name: language,
                    nativeName: language,
                });
            const raw = await sdk.entry.get({
                templateId: id.templateId,
                entryId: id.entryId,
                skipCache: true,
            });
            const meta = structuredClone(
                raw.meta.find((item) => item.lng === id.language),
            );
            meta.lng = language;
            meta.props[0].data = [newerTitle];
            await sdk.entry.update({
                _id: raw._id,
                templateId: raw.templateId,
                expectedUpdatedAt: raw.updatedAt,
                lng: language,
                meta,
                content: { nodes: [] },
            });
            const original = sdk.group.getAll.bind(sdk.group);
            window.__b5Delay = { held: false };
            sdk.group.getAll = async (...args) => {
                const result = await original(...args);
                if (!window.__b5Delay.held) {
                    window.__b5Delay.held = true;
                    await new Promise((resolve) => {
                        window.__b5Delay.release = resolve;
                    });
                }
                return result;
            };
        },
        { id, language, newerTitle },
    );
    await navigate(page, location(id));
    await expect
        .poll(() => page.evaluate(() => window.__b5Delay.held))
        .toBe(true);
    await navigate(page, location(id, { language }));
    await expect(page.getByLabel('内容语言', { exact: true })).toHaveValue(
        language,
    );
    await expect(title(page)).toHaveText(newerTitle);
    await page.evaluate(() => window.__b5Delay.release());
    await expect
        .poll(() => page.evaluate(() => window.bcms.sdk.storage.get('lng')))
        .toBe(language);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.bcms.sdk.storage.get('lng'))).toBe(
        language,
    );
    await title(page).fill(savedTitle);
    const saved = page.waitForResponse(
        (response) =>
            response.request().method() === 'PUT' &&
            new URL(response.url()).pathname.endsWith('/entry/update'),
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().lng).toBe(language);
    expect(
        await page.evaluate(
            async ({ id, savedTitle }) =>
                (
                    await window.bcms.sdk.entry.get({
                        templateId: id.templateId,
                        entryId: id.entryId,
                        skipCache: true,
                    })
                ).meta.find((item) => item.lng === id.language).props[0]
                    .data[0] !== savedTitle,
            { id, savedTitle },
        ),
    ).toBe(true);
});

test('B5 review retired legacy adapter cannot redirect after leaving its delayed load', async ({
    page,
    installation,
}) => {
    const id = await fixture(page);
    await page.evaluate((id) => {
        const sdk = window.bcms.sdk;
        const original = sdk.entry.get.bind(sdk.entry);
        window.__b5Delay = { held: false };
        sdk.entry.get = async (...args) => {
            const result = await original(...args);
            if (!window.__b5Delay.held && args[0].entryId === id.entryId) {
                window.__b5Delay.held = true;
                await new Promise((resolve) => {
                    window.__b5Delay.release = resolve;
                });
            }
            return result;
        };
    }, id);
    await navigate(
        page,
        `/d/template/${id.templateId}/entry/${id.entryId}?language=${id.language}`,
    );
    await expect
        .poll(() => page.evaluate(() => window.__b5Delay.held))
        .toBe(true);
    await navigate(page, '/d/studio?section=settings');
    await expect(page.getByLabel('网站名称', { exact: true })).toBeVisible();
    const before = page.url();
    await page.evaluate(() => window.__b5Delay.release());
    await page.waitForTimeout(200);
    expect(page.url()).toBe(before);
    await expect(page.getByLabel('网站名称', { exact: true })).toBeVisible();
});

test('B5 review independent settings preserve stay discard unload and busy guards', async ({
    page,
    installation,
}) => {
    await navigate(page, '/d/studio?section=settings');
    const name = page.getByLabel('网站名称', { exact: true });
    const original = await name.inputValue();
    await name.fill('B5 unsaved settings');
    let accept = false;
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
        dialogs++;
        if (accept) await dialog.accept();
        else await dialog.dismiss();
    });
    await page
        .getByRole('button', { name: '编辑网站导航 →', exact: true })
        .click();
    await expect(name).toHaveValue('B5 unsaved settings');
    expect(dialogs).toBe(1);
    expect(
        await page.evaluate(
            () =>
                !window.dispatchEvent(
                    new Event('beforeunload', { cancelable: true }),
                ),
        ),
    ).toBe(true);
    await navigate(page, '/d/studio?section=pages');
    await expect(name).toHaveValue('B5 unsaved settings');
    expect(dialogs).toBe(2);
    await navigate(page, '/d/domains');
    await expect(name).toHaveValue('B5 unsaved settings');
    expect(dialogs).toBe(3);
    await page.evaluate(() => history.back());
    await expect.poll(() => dialogs).toBe(4);
    await expect(name).toHaveValue('B5 unsaved settings');
    accept = true;
    await page
        .getByRole('button', { name: '编辑品牌与联系资料 →', exact: true })
        .click();
    await expect(workspace(page)).toHaveCount(1);
    await navigate(page, '/d/studio?section=settings');
    await expect(name).toHaveValue(original);
    const savedName =
        'B5 settings acknowledged ' + crypto.randomUUID().slice(0, 8);
    await name.fill(savedName);
    // Exercise a legal request through the real controls. Persisted absent media
    // refs may return as null after an earlier save; explicitly choose unset.
    await page.getByLabel('社交分享图片', { exact: true }).selectOption('');
    await page.getByLabel('网站图标', { exact: true }).selectOption('');
    await page.evaluate(() => {
        const sdk = window.bcms.sdk;
        const original = sdk.studio.saveSettings.bind(sdk.studio);
        window.__b5Delay = { held: false };
        sdk.studio.saveSettings = async (...args) => {
            window.__b5Delay.shape = Object.fromEntries(
                Object.entries(args[0].operations).map(([key, value]) => [
                    key,
                    value === null ? 'null' : typeof value,
                ]),
            );
            let result;
            try {
                result = await original(...args);
            } catch (cause) {
                window.__b5Delay.error = {
                    status: cause.status,
                    message: cause.message,
                };
                throw cause;
            }
            window.__b5Delay.held = true;
            await new Promise((resolve) => {
                window.__b5Delay.release = resolve;
            });
            return result;
        };
    });
    await page
        .getByRole('button', { name: '保存设置草稿', exact: true })
        .click();
    await expect
        .poll(() =>
            page.evaluate(() =>
                Boolean(window.__b5Delay.held || window.__b5Delay.error),
            ),
        )
        .toBe(true);
    const diagnostic = await page.evaluate(() => ({
        error: window.__b5Delay.error,
        shape: window.__b5Delay.shape,
    }));
    expect(diagnostic.error, JSON.stringify(diagnostic)).toBeUndefined();
    await navigate(page, '/d/studio?section=pages');
    await expect(name).toHaveValue(savedName);
    expect(
        await page.evaluate(
            () =>
                !window.dispatchEvent(
                    new Event('beforeunload', { cancelable: true }),
                ),
        ),
    ).toBe(true);
    await page.evaluate(() => window.__b5Delay.release());
    await expect(page.getByRole('status')).toContainText('网站设置已保存');
    await navigate(page, '/d/studio?section=pages');
    await expect(page).toHaveURL(/section=pages/);
});

test('B5 review retired settings save cannot refresh notify error or finalize a newer context', async ({
    page,
    installation,
}) => {
    for (const failAfterAcknowledgement of [false, true]) {
        await page.goto('/d/studio?section=settings');
        const name = page.getByLabel('网站名称', { exact: true });
        await name.fill(
            'B5 retired settings ' + crypto.randomUUID().slice(0, 8),
        );
        await page.getByLabel('社交分享图片', { exact: true }).selectOption('');
        await page.getByLabel('网站图标', { exact: true }).selectOption('');
        await page.evaluate((fail) => {
            const sdk = window.bcms.sdk;
            const original = sdk.studio.saveSettings.bind(sdk.studio);
            const originalGet = sdk.studio.getSite.bind(sdk.studio);
            window.__b5Delay = { held: false, done: false, refreshes: 0 };
            sdk.studio.saveSettings = async (...args) => {
                const result = await original(...args);
                window.__b5Delay.held = true;
                await new Promise((resolve) => {
                    window.__b5Delay.release = resolve;
                });
                window.__b5Delay.done = true;
                if (fail) throw new Error('B5 retired settings continuation');
                return result;
            };
            sdk.studio.getSite = async (...args) => {
                if (window.__b5Delay.held) window.__b5Delay.refreshes++;
                return originalGet(...args);
            };
        }, failAfterAcknowledgement);
        const save = page.getByRole('button', {
            name: '保存设置草稿',
            exact: true,
        });
        await save.click();
        await expect
            .poll(() => page.evaluate(() => window.__b5Delay.held))
            .toBe(true);
        // selectContext retires the SDK context before leaving the document.
        // Hold this document to inspect the old owner's late continuations.
        await page.evaluate(() => {
            window.bcms.sdk.context = null;
            window.__b5Delay.release();
        });
        await expect
            .poll(() => page.evaluate(() => window.__b5Delay.done))
            .toBe(true);
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => window.__b5Delay.refreshes)).toBe(0);
        await expect(page.getByRole('status')).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(save).toBeDisabled();
    }
});
