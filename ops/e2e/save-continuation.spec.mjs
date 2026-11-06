import { test, expect } from './browser-fixture.mjs';
const saved = '草稿已保存。发布更新后才会同步到网站。';
async function openShared(page) {
    await page.goto('/d/studio?section=pages');
    await page.getByRole('button', { name: '新增页面', exact: true }).click();
    await page.locator('.studio-page-blueprints button').first().click();
    await page.getByRole('tab', { name: '页面内容', exact: true }).click();
    await page
        .locator('.studio-workspace-content [contenteditable="true"]')
        .first()
        .fill('Cache regression ' + Date.now());
    await page.getByRole('tab', { name: '页面信息', exact: true }).click();
    await page.getByLabel('页面名称', { exact: true }).fill('Cache regression');
    await page.getByLabel(/^访问路径/).fill('/pages/cache-' + Date.now());
    const response = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === '/api/v4/studio/pages' &&
            r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    const created = await (await response).json();
    await expect(page).not.toHaveURL(/entryId=create/);
    const id = await page.evaluate(async (created) => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((m) => m.key === 'content-page');
        const blueprint = state.site.pages.find(
            (p) => p.modelKey === model.key && !p.blueprintKey,
        );
        await sdk.studio.savePage(created.key, {
            title: created.title,
            path: created.path,
            seoTitle: created.seoTitle,
            seoDescription: created.seoDescription,
            sections: created.sections,
            layoutDocument: created.layoutDocument,
            entryId: model.entries[0].id,
            enabled: true,
            navigation: true,
            expectedUpdatedAt: created.siteUpdatedAt,
        });
        return {
            workspaceId: sdk.context.context.workspaceId,
            siteId: state.site.id,
            templateId: model.templateId,
            entryId: model.entries[0].id,
            language: state.site.language,
            modelKey: model.key,
            pageKey: created.key,
            alternate: blueprint.key,
        };
    }, created);
    const { alternate, ...query } = id;
    await page.goto(
        '/d/studio?' +
            new URLSearchParams({
                section: 'content',
                ...query,
                panel: 'page',
            }),
    );
    await expect(
        page.getByRole('region', { name: '内容编辑工作区', exact: true }),
    ).toBeVisible();
    return id;
}
test('saved page receipt survives picker return and a later full-page save', async ({
    page,
    installation,
}, info) => {
    const id = await openShared(page);
    await page.getByRole('tab', { name: '页面信息', exact: true }).click();
    const seo = 'CONFIRMED SEO ' + info.project.name;
    await page.getByLabel('SEO 标题', { exact: true }).first().fill(seo);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    // Keep unrelated Entry and settings drafts while changing only the page selection.
    await page
        .getByLabel('网站名称', { exact: true })
        .fill('RETAIN SETTINGS ' + info.project.name);
    await page.getByRole('tab', { name: '页面内容', exact: true }).click();
    const title = page
        .locator('.studio-workspace-content [contenteditable="true"]')
        .first();
    await title.fill('RETAIN CONTENT ' + info.project.name);
    await page.getByRole('tab', { name: '页面信息', exact: true }).click();
    await page
        .getByLabel('查看页面', { exact: true })
        .selectOption(id.alternate);
    await page.getByLabel('查看页面', { exact: true }).selectOption(id.pageKey);
    await expect(
        page.getByLabel('SEO 标题', { exact: true }).first(),
    ).toHaveValue(seo);
    await expect(page.getByLabel('网站名称', { exact: true })).toHaveValue(
        'RETAIN SETTINGS ' + info.project.name,
    );
    await page.getByRole('tab', { name: '页面内容', exact: true }).click();
    await expect(title).toHaveText('RETAIN CONTENT ' + info.project.name);
    await page.getByRole('tab', { name: '页面信息', exact: true }).click();
    await page
        .getByLabel('SEO 描述', { exact: true })
        .first()
        .fill('Later description');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
    expect(
        await page.evaluate(
            async (key) =>
                (await window.bcms.sdk.studio.getSite()).site.pages.find(
                    (p) => p.key === key,
                ).seoTitle,
            id.pageKey,
        ),
    ).toBe(seo);
});
for (const failure of ['ordinary', 'conflict', 'unknown'])
    test(
        'created Entry continues after settings ' +
            failure +
            ' without a false content conflict',
        async ({ page, installation }, info) => {
            await page.evaluate(async () => {
                const sdk = window.bcms.sdk;
                if (!(await sdk.language.getAll()).some((l) => l.code === 'fr'))
                    await sdk.language.create({
                        code: 'fr',
                        name: 'French',
                        nativeName: 'Français',
                    });
            });
            await page.goto('/d/studio?section=pages');
            await page
                .getByRole('button', { name: '新增页面', exact: true })
                .click();
            await page
                .locator('.studio-page-blueprints button')
                .first()
                .click();
            await page
                .getByRole('tab', { name: '页面信息', exact: true })
                .click();
            await page
                .getByLabel('页面名称', { exact: true })
                .fill('Continuation ' + failure);
            await page
                .getByLabel(/^访问路径/)
                .fill('/pages/continue-' + failure + '-' + info.project.name);
            const name =
                'PENDING SETTINGS ' + failure + ' ' + info.project.name;
            await page.getByLabel('网站名称', { exact: true }).fill(name);
            await page
                .getByRole('tab', { name: '页面内容', exact: true })
                .click();
            const title = page
                .locator('.studio-workspace-content [contenteditable="true"]')
                .first();
            await title.fill(
                'FIRST CONTENT ' + failure + ' ' + info.project.name,
            );
            await page
                .getByRole('tab', { name: '页面信息', exact: true })
                .click();
            await page
                .getByLabel(/^访问路径/)
                .fill('/pages/continue-' + failure + '-' + info.project.name);
            await page
                .getByRole('tab', { name: '页面内容', exact: true })
                .click();
            let createReceipt;
            let creates = 0;
            const content = [];
            page.on('response', async (response) => {
                if (
                    new URL(response.url()).pathname ===
                        '/api/v4/studio/pages' &&
                    response.request().method() === 'POST' &&
                    response.ok()
                ) {
                    creates++;
                    createReceipt = await response.json();
                }
            });
            page.on('request', (request) => {
                if (
                    request.method() === 'POST' &&
                    new URL(request.url()).pathname.includes('/studio/entries/')
                )
                    content.push(request.postDataJSON());
            });
            // Author a second language in the initial full create request so the
            // continuation must preserve real noncurrent-language server data.
            await page.route(
                '**/api/v4/studio/pages',
                async (route) => {
                    const body = route.request().postDataJSON();
                    const translated = structuredClone(body.entry.meta[0]);
                    translated.lng = 'fr';
                    translated.props[0].data = ['French continuation ' + crypto.randomUUID()];
                    translated.props[1].data = ['fr-' + crypto.randomUUID()];
                    body.entry.meta.push(translated);
                    body.entry.content.push({
                        lng: 'fr',
                        nodes: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: 'French preserved body',
                                    },
                                ],
                            },
                        ],
                        plainText: 'French preserved body',
                    });
                    await route.continue({ postData: JSON.stringify(body) });
                },
                { times: 1 },
            );
            await page.route(
                '**/api/v4/studio/settings',
                async (route) => {
                    if (failure === 'unknown') {
                        await route.fetch();
                        await route.abort('failed');
                    } else
                        await route.fulfill({
                            status: failure === 'conflict' ? 409 : 400,
                            contentType: 'application/json',
                            body: JSON.stringify({
                                message: 'Settings retry fixture',
                            }),
                        });
                },
                { times: 1 },
            );
            await page
                .getByRole('button', { name: '保存草稿', exact: true })
                .click();
            await expect(page.getByRole('alert')).toContainText(
                '网站设置未保存',
            );
            await expect(page).toHaveURL(/entryId=create/);
            const actual = await page.evaluate(async () => {
                const sdk = window.bcms.sdk;
                const state = await sdk.studio.getSite();
                return state.site.pages;
            });
            const receipt = createReceipt.data || createReceipt;
            const created = actual.find((p) => p.key === receipt.key);
            expect(created).toBeTruthy();
            const before = await page.evaluate(
                async (id) =>
                    window.bcms.sdk.entry.get({
                        templateId: id.templateId,
                        entryId: id.entryId,
                        skipCache: true,
                    }),
                {
                    templateId:
                        created.templateId ||
                        (await page.evaluate(
                            async () =>
                                (
                                    await window.bcms.sdk.studio.getSite()
                                ).models.find((m) => m.key === 'content-page')
                                    .templateId,
                        )),
                    entryId: receipt.entryId,
                },
            );
            await title.fill(
                'EDIT AFTER CREATION ' + failure + ' ' + info.project.name,
            );
            await page
                .getByRole('tab', { name: '页面信息', exact: true })
                .click();
            await expect(
                page.getByLabel('网站名称', { exact: true }),
            ).toHaveValue(name);
            if (failure !== 'ordinary') {
                await page
                    .getByRole('button', {
                        name: '核对服务器版本',
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole('button', {
                        name: '保留本地修改并采用此版本',
                        exact: true,
                    })
                    .click();
            }
            await page
                .getByRole('button', { name: '保存草稿', exact: true })
                .click();
            await expect.poll(() => content.length).toBe(1);
            expect(content[0].expectedUpdatedAt).toBe(before.updatedAt);
            await expect(page).not.toHaveURL(/entryId=create/);
            expect(creates).toBe(1);
            const after = await page.evaluate(
                async (id) => ({
                    entry: await window.bcms.sdk.entry.get({
                        templateId: id.templateId,
                        entryId: id._id,
                        skipCache: true,
                    }),
                    site: (await window.bcms.sdk.studio.getSite()).site,
                }),
                before,
            );
            expect(JSON.stringify(after.entry)).toContain(
                'EDIT AFTER CREATION ' + failure + ' ' + info.project.name,
            );
            expect(after.site.name).toBe(name);
            expect(after.entry.updatedAt).toBeGreaterThan(before.updatedAt);
            expect(before.meta.some((meta) => meta.lng === 'fr')).toBe(true);
            for (const key of ['meta', 'content', 'statuses'])
                expect(
                    after.entry[key].filter(
                        (item) => item.lng !== after.site.language,
                    ),
                ).toEqual(
                    before[key].filter(
                        (item) => item.lng !== after.site.language,
                    ),
                );
        },
    );
