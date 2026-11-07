import { editStructured, retireRichEditor } from './launch-structured.mjs';
import { expect } from '@playwright/test';
import {
    workspace,
    state,
    openContent,
    openHero,
    save,
} from './launch-workspace.mjs';
export async function runEditorScenarios({
    page,
    capture,
    proof,
    marker,
    target,
    traceSteps,
}) {
    await capture('SINGLE_EDITOR', async () => {
        await openContent(page);
        expect(await workspace(page).count()).toBe(1);
        traceSteps.step('editor-open');
    });
    await capture('CONTENT', async () => {
        await page.locator('#studio-field-headline').fill(marker);
        traceSteps.step('draft-input');
        await save(page);
        const current = await state(page);
        expect(JSON.stringify(current)).toContain(marker);
        await page.getByRole('tab', { name: '页面信息', exact: true }).click();
        await page
            .getByLabel('网站名称', { exact: true })
            .fill(marker + ' Brand');
        await save(page);
        expect((await state(page)).site.name).toBe(marker + ' Brand');
        await openContent(page, 'product');
        await page.locator('#studio-field-price').fill('127');
        await page
            .locator('.studio-workspace-content [contenteditable="true"]')
            .first()
            .fill(marker + ' product first');
        await save(page);
        expect(
            (await state(page)).models.find((m) => m.key === 'product')
                .entries[0].fields.price,
        ).toEqual([127]);
        await openContent(page);
    });
    const heroTitle = await openHero(page);
    await heroTitle.fill(marker);
    if (
        await page
            .getByRole('button', { name: '保存草稿', exact: true })
            .isEnabled()
    )
        await save(page);
    await openContent(page);
    await capture('MEDIA', async () => {
        const mediaPath = await page.evaluate(async () => {
            const sdk = window.bcms.sdk,
                s = await sdk.studio.getSite(),
                m = s.models.find((m) => m.key === 'home'),
                t = await sdk.template.get({
                    templateId: m.templateId,
                }),
                languages = await sdk.language.getAll();
            return `entry.meta.${languages.findIndex((l) => l.code === s.site.language)}.props.${t.props.findIndex((p) => p.name === 'heroImage')}`;
        });
        const field = page.locator(
            `[data-bcms-prop-input-wrapper][id="${mediaPath}"]`,
        );
        await field.locator('button').first().click();
        const picker = page.getByRole('dialog', {
            name: '媒体选择器',
            exact: true,
        });
        await picker
            .getByRole('button', { name: '上传文件', exact: true })
            .click();
        const upload = page
            .getByRole('dialog')
            .filter({ has: page.locator('input[type="file"]') });
        const filename = marker + '.png';
        await upload.locator('input[type="file"]').setInputFiles({
            name: filename,
            mimeType: 'image/png',
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
                'base64',
            ),
        });
        const response = page.waitForResponse(
            (r) =>
                r.request().method() === 'POST' &&
                new URL(r.url()).pathname === '/api/v4/media/create/file',
        );
        await upload.getByRole('button', { name: '创建', exact: true }).click();
        const receipt = await response;
        expect(receipt.status()).toBe(200);
        const media = (await receipt.json()).item;
        proof.mediaId = media._id;
        await picker
            .locator('[bcms-media-data]')
            .filter({
                has: page.getByAltText(filename, { exact: true }),
            })
            .first()
            .locator('..')
            .click();
        await picker.getByRole('button', { name: '完成', exact: true }).click();
        await save(page);
        await page.reload();
        await expect(field).toContainText(filename);
        return { mediaId: media._id, uploadedThroughPicker: true };
    });
    await capture('SEO', async () => {
        await page.getByRole('tab', { name: '页面信息', exact: true }).click();
        await page
            .getByLabel('SEO 标题', { exact: true })
            .first()
            .fill(marker + ' SEO');
        await page
            .getByLabel('SEO 描述', { exact: true })
            .first()
            .fill(marker + ' description');
        await save(page);
        expect(
            (await state(page)).site.pages.find((p) => p.key === 'home')
                .seoTitle,
        ).toBe(marker + ' SEO');
    });
    await capture('LEGACY_EDITOR_LINKS', async () => {
        const current = await state(page);
        const home = current.models.find((m) => m.key === 'home');
        await page.goto(
            `/d/template/${home.templateId}/entry/${home.entries[0].id}`,
        );
        await expect(workspace(page)).toBeVisible();
        expect(await workspace(page).count()).toBe(1);
        await openContent(page);
    });
    await capture('PAGE', async () => {
        const before = (await state(page)).site.pages.length;
        await page.goto('/d/studio?section=pages');
        await page
            .getByRole('button', { name: '新增页面', exact: true })
            .click();
        await page.locator('.studio-page-blueprints button').first().click();
        await expect(workspace(page)).toHaveCount(1);
        await page.getByRole('tab', { name: '页面内容', exact: true }).click();
        await page
            .locator('.studio-workspace-content [contenteditable="true"]')
            .first()
            .fill(marker + ' Contact');
        await page.getByRole('tab', { name: '页面信息', exact: true }).click();
        await page
            .getByLabel('页面名称', { exact: true })
            .fill(marker + ' Contact');
        await page.getByLabel(/^访问路径/).fill('/pages/d1-' + target.id);
        const createdResponse = page.waitForResponse(
            (r) =>
                r.request().method() === 'POST' &&
                new URL(r.url()).pathname === '/api/v4/studio/pages',
        );
        await page
            .getByRole('button', { name: '保存草稿', exact: true })
            .click();
        const response = await createdResponse;
        expect(response.status()).toBe(200);
        const receipt = await response.json();
        expect(receipt.entryId).toBeTruthy();
        expect(receipt.key).toBeTruthy();
        expect(receipt.siteUpdatedAt).toBeGreaterThan(0);
        expect(receipt.entryUpdatedAt).toBeGreaterThan(0);
        const mounted = new URL(page.url()).searchParams;
        const currentState = await state(page);
        const model = currentState.models.find(
            (m) => m.key === receipt.modelKey,
        );
        for (const [key, value] of Object.entries({
            workspaceId: proof.site.cmsWorkspaceId,
            siteId: proof.site.cmsSiteId,
            modelKey: receipt.modelKey,
            templateId: model.templateId,
            entryId: receipt.entryId,
            pageKey: receipt.key,
        }))
            expect(mounted.get(key), key).toBe(value);
        expect(currentState.site.updatedAt).toBe(receipt.siteUpdatedAt);
        const persisted = await page.evaluate(
            async ({ templateId, entryId }) =>
                window.bcms.sdk.entry.get({
                    templateId,
                    entryId,
                    skipCache: true,
                }),
            { templateId: model.templateId, entryId: receipt.entryId },
        );
        expect(persisted.updatedAt).toBe(receipt.entryUpdatedAt);
        expect(JSON.stringify(persisted)).toContain(marker + ' Contact');
        expect(
            currentState.site.pages.find((p) => p.key === receipt.key),
        ).toMatchObject({
            entryId: receipt.entryId,
            path: '/pages/d1-' + target.id,
        });
        proof.pageReceipt = receipt;
        await expect(
            page.getByRole('button', { name: '保存草稿', exact: true }),
        ).toBeDisabled();
        const current = await state(page);
        expect(current.site.pages.length).toBe(before + 1);
        expect(
            current.site.pages.some((p) => p.path === '/pages/d1-' + target.id),
        ).toBe(true);
    });
    await capture('NAVIGATION', async () => {
        await page.getByRole('tab', { name: '页面信息', exact: true }).click();
        const navigation = page.getByRole('region', {
            name: '网站导航',
            exact: true,
        });
        await navigation
            .getByLabel('选择页面', { exact: true })
            .selectOption('/pages/d1-' + target.id);
        await navigation
            .locator('.studio-navigation-actions')
            .getByRole('button', { name: '添加页面', exact: true })
            .click();
        await navigation
            .getByRole('button', { name: '添加分组', exact: true })
            .first()
            .click();
        await navigation
            .getByLabel('导航名称', { exact: true })
            .last()
            .fill(marker + ' Menu');
        const child = navigation.locator('.studio-navigation-item').filter({
            has: page.locator(
                `.studio-navigation-path:text-is("/pages/d1-${target.id}")`,
            ),
        });
        await child
            .getByRole('combobox')
            .selectOption({ label: marker + ' Menu' });
        await save(page);
        const current = await state(page);
        const group = current.site.navigation.find(
            (n) => n.label === marker + ' Menu',
        );
        expect(group).toBeTruthy();
        expect(
            group.children.some((n) => n.href === '/pages/d1-' + target.id),
        ).toBe(true);
        expect(
            current.site.navigation.some(
                (n) => n.href === '/pages/d1-' + target.id,
            ),
        ).toBe(false);
        await openContent(page);
    });
    await capture('STRUCTURED_CONTENT', async () => {
        await openContent(page, 'content-page');
        const rich = page
            .locator(
                '.studio-workspace-content .bcmsEntryContentEditor .ProseMirror',
            )
            .first();
        await rich.fill('');
        await rich.focus();
        await page.keyboard.type('**' + marker + ' rich** ', {
            delay: 20,
        });
        await page.keyboard.press('Enter');
        await page.keyboard.type('* ' + marker + ' list');
        await expect(rich.locator('strong')).toContainText(marker + ' rich');
        await expect(rich.locator('ul li')).toContainText(marker + ' list');
        await save(page);
        await page.reload();
        await expect(rich.locator('strong')).toContainText(marker + ' rich');
        await expect(rich.locator('ul li')).toContainText(marker + ' list');
        const raw = await page.evaluate(async () => {
            const sdk = window.bcms.sdk,
                s = await sdk.studio.getSite(),
                m = s.models.find((m) => m.key === 'content-page');
            return sdk.entry.get({
                templateId: m.templateId,
                entryId: m.entries[0].id,
                skipCache: true,
            });
        });
        expect(JSON.stringify(raw)).toContain('"type":"bold"');
        expect(JSON.stringify(raw)).toContain('"type":"bulletList"');
        await editStructured(page, {
            ownMedia: proof.mediaId,
            filename: marker + '.png',
        });
        await retireRichEditor(page, {
            ownMedia: proof.mediaId,
            filename: marker + '.png',
        });
        await openContent(page);
        return {
            richMarksAndListsRetained: true,
            linksArraysWidgetsAndRetiredEditor: true,
        };
    });
    await capture('TEMPLATE_LAYOUT', async () => {
        const denied = await page.evaluate(async () => {
            const sdk = window.bcms.sdk,
                s = await sdk.studio.getSite(),
                p = s.site.pages.find((p) => p.key === 'home');
            const request = {
                expectedUpdatedAt: s.site.updatedAt,
                title: p.title,
                path: p.path,
                seoTitle: p.seoTitle,
                seoDescription: p.seoDescription,
                sections: p.sections,
                entryId: p.entryId,
                enabled: true,
                navigation: true,
                layoutDocument: p.layoutDocument,
            };
            const good = await sdk.studio.savePage(p.key, request);
            request.expectedUpdatedAt = good.siteUpdatedAt;
            const statuses = [];
            for (const change of [
                {
                    layoutDocument: {
                        version: 1,
                        mode: 'structured',
                        root: [],
                    },
                },
                { sections: ['illegal-section'] },
                {
                    layoutDocument: {
                        version: 1,
                        mode: 'template',
                        root: [
                            {
                                id: 'illegal',
                                type: 'undeclared-block',
                                props: {},
                            },
                        ],
                    },
                },
            ]) {
                try {
                    await sdk.studio.savePage(p.key, { ...request, ...change });
                    statuses.push(200);
                } catch (error) {
                    statuses.push(error.status);
                }
            }
            const after = await sdk.studio.getSite();
            return {
                statuses,
                unchanged: after.site.updatedAt === good.siteUpdatedAt,
            };
        });
        expect(denied).toEqual({ statuses: [400, 400, 400], unchanged: true });
    });
    await capture('EDIT_CONFLICT', async () => {
        const peer = await page.context().newPage();
        try {
            await peer.goto('/d/studio');
            await peer.waitForFunction(() =>
                Boolean(window.bcms?.sdk?.context),
            );
            await openContent(peer);
            await page
                .locator('#studio-field-headline')
                .fill(marker + ' local conflict');
            await peer
                .locator('#studio-field-headline')
                .fill(marker + ' concurrent');
            await save(peer);
            await page
                .getByRole('button', { name: '保存草稿', exact: true })
                .click();
            await expect(page.getByRole('alert')).toContainText(
                /冲突|已被修改|内容已变更|服务器/,
            );
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
            await save(page);
        } finally {
            await peer.close();
        }
    });
    await capture('PARTIAL_SAVE', async () => {
        await page.locator('#studio-field-headline').fill(marker);
        await page.getByRole('tab', { name: '页面信息', exact: true }).click();
        await page
            .getByLabel('页面名称', { exact: true })
            .fill(marker + ' Home');
        let writes = 0;
        const listener = (r) => {
            if (
                r.method() === 'POST' &&
                new URL(r.url()).pathname.includes('/studio/entries/')
            )
                writes++;
        };
        page.on('request', listener);
        await page.route(
            '**/api/v4/studio/pages/*',
            (route) =>
                route.fulfill({
                    status: 409,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        message: 'Site changed; refresh before saving',
                    }),
                }),
            { times: 1 },
        );
        await page
            .getByRole('button', { name: '保存草稿', exact: true })
            .click();
        await expect(page.getByRole('alert')).toContainText(
            '内容已保存，页面设置未保存',
        );
        expect(writes).toBe(1);
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
        await save(page);
        expect(writes).toBe(1);
        page.off('request', listener);
    });
}
