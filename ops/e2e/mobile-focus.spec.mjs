import { test, expect } from './browser-fixture.mjs';
for (const kind of ['input', 'rich'])
    test(
        'mobile ' +
            kind +
            ' surface return restores caret without rebuilding preview',
        async ({ page, installation }, info) => {
            test.skip(info.project.name !== 'mobile', 'mobile surface control');
            const id = await page.evaluate(async () => {
                const sdk = window.bcms.sdk;
                await sdk.ensureContext();
                const state = await sdk.studio.getSite();
                const model = state.models.find((m) => m.key === 'home');
                return {
                    workspaceId: sdk.context.context.workspaceId,
                    siteId: state.site.id,
                    templateId: model.templateId,
                    entryId: model.entries[0].id,
                    language: state.site.language,
                    modelKey: model.key,
                    pageKey: state.site.pages.find((p) => p.layout === 'home')
                        .key,
                };
            });
            await page.goto(
                '/d/studio?' +
                    new URLSearchParams({
                        section: 'content',
                        ...id,
                        field: 'headline',
                        panel: 'content',
                    }),
            );
            const rich = page.locator('#studio-field-headline');
            await expect(rich).toBeVisible();
            await expect(page.locator('iframe[title="草稿预览"]')).toHaveCount(
                1,
            );
            {
                if (kind === 'input')
                    await page
                        .getByRole('tab', { name: '页面信息', exact: true })
                        .click();
                else
                    await page
                        .getByRole('tab', { name: '页面内容', exact: true })
                        .click();
                const owner =
                    kind === 'input'
                        ? page.getByLabel('SEO 标题', { exact: true }).first()
                        : rich;
                await owner.fill('ABCDEF');
                await owner.evaluate((el) => {
                    el.focus();
                    if (el instanceof HTMLInputElement)
                        el.setSelectionRange(3, 3);
                    else {
                        const range = document.createRange();
                        range.setStart(
                            document
                                .createTreeWalker(el, NodeFilter.SHOW_TEXT)
                                .nextNode(),
                            3,
                        );
                        range.collapse(true);
                        const selection = getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                    window.__b7Owner = el;
                    window.__b7Frame = document.querySelector(
                        'iframe[title="草稿预览"]',
                    );
                });
                await page.keyboard.type('x');
                await page.waitForTimeout(550);
                let requests = 0;
                const count = (request) => {
                    if (
                        new URL(request.url()).pathname ===
                        '/api/v4/studio/preview'
                    )
                        requests++;
                };
                page.on('request', count);
                await page
                    .getByRole('tab', { name: '查看画布', exact: true })
                    .click();
                await page
                    .getByRole('tab', { name: '编辑内容', exact: true })
                    .click();
                await expect(owner).toBeFocused();
                expect(
                    await owner.evaluate(
                        (el) =>
                            el === window.__b7Owner &&
                            document.querySelector(
                                'iframe[title="草稿预览"]',
                            ) === window.__b7Frame,
                    ),
                ).toBe(true);
                await page.waitForTimeout(250);
                expect(requests).toBe(0);
                page.off('request', count);
                await page.keyboard.type('y');
                if (kind === 'input')
                    await expect(owner).toHaveValue('ABCxyDEF');
                else await expect(owner).toHaveText('ABCxyDEF');
                const save = page.getByRole('button', {
                    name: '保存草稿',
                    exact: true,
                });
                await save.focus();
                await page.waitForTimeout(650);
                await expect(save).toBeFocused();
                // Keyboard activation uses the same explicit return and keeps the caret.
                await page
                    .getByRole('tab', { name: '查看画布', exact: true })
                    .focus();
                await page.keyboard.press('Enter');
                await page
                    .getByRole('tab', { name: '编辑内容', exact: true })
                    .focus();
                await page.keyboard.press('Enter');
                await expect(owner).toBeFocused();
                await page.keyboard.type('z');
                if (kind === 'input') {
                    await expect(owner).toHaveValue('ABCxyzDEF');
                    const alternate = page
                        .getByLabel('SEO 描述', { exact: true })
                        .first();
                    await alternate.fill('Other field');
                    await page.waitForTimeout(650);
                    await expect(alternate).toBeFocused();
                    await page
                        .getByRole('tab', { name: '查看画布', exact: true })
                        .click();
                    await page
                        .getByRole('tab', { name: '编辑内容', exact: true })
                        .click();
                    await expect(alternate).toBeFocused();
                    await page.keyboard.type('!');
                    await expect(alternate).toHaveValue('Other field!');
                } else await expect(owner).toHaveText('ABCxyzDEF');
            }
        },
    );
