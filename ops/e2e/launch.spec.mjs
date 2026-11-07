import { test, expect } from './browser-fixture.mjs';
import {
    acceptanceTemplates,
    completeAcceptance,
} from './acceptance-report.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const enabled = process.env.STOREFRONT_E2E_LAUNCH === '1';
const local = process.env.STOREFRONT_E2E_LAUNCH_LOCAL === '1';
const runId = process.env.STOREFRONT_E2E_RUN_ID;
const saved = '草稿已保存。发布更新后才会同步到网站。';
const workspace = (page) =>
    page.getByRole('region', { name: '内容编辑工作区', exact: true });
async function state(page) {
    return page.evaluate(async () => window.bcms.sdk.studio.getSite());
}
async function openContent(page, modelKey = 'home') {
    const id = await page.evaluate(async (modelKey) => {
        const sdk = window.bcms.sdk,
            s = await sdk.studio.getSite(),
            m = s.models.find((m) => m.key === modelKey);
        return {
            workspaceId: sdk.context.context.workspaceId,
            siteId: s.site.id,
            templateId: m.templateId,
            entryId: m.entries[0].id,
            language: s.site.language,
            modelKey,
            pageKey: s.site.pages.find(
                (p) =>
                    p.modelKey === modelKey &&
                    (p.entryId === m.entries[0].id ||
                        (m.singleEntry && !p.entryId)),
            )?.key,
        };
    }, modelKey);
    await page.goto(
        '/d/studio?' +
            new URLSearchParams(
                Object.fromEntries(
                    Object.entries({
                        section: 'content',
                        ...id,
                        field:
                            modelKey === 'home'
                                ? 'headline'
                                : modelKey === 'product'
                                  ? 'price'
                                  : 'body',
                        panel: 'content',
                    }).filter(([, v]) => v !== undefined),
                ),
            ),
    );
    await expect(workspace(page)).toBeVisible();
}
async function openHero(page) {
    await openContent(page);
    const hero = await page.evaluate(async () => {
        const s = await window.bcms.sdk.studio.getSite(),
            root = s.site.pages.find((p) => p.key === 'home').layoutDocument
                ?.root;
        return root?.some((n) => n.type === 'hero')
            ? {
                  index: root.findIndex((n) => n.type === 'hero'),
                  id: root.find((n) => n.type === 'hero').id,
              }
            : null;
    });
    if (!hero) return page.locator('#studio-field-headline');
    await page.getByRole('tab', { name: '区块', exact: true }).click();
    await page.locator('.studio-visual-node-button').nth(hero.index).click();
    return page.locator(`#section-${hero.id}-title`);
}
async function save(page) {
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
}
for (const target of acceptanceTemplates)
    test(`launch ${target.id}`, async ({ page, traceSteps }, info) => {
        test.skip(!enabled, 'Dedicated launch runner required');
        test.setTimeout(180000);
        page.setDefaultTimeout(15000);
        const marker = `D1-${runId}-${target.id}`;
        const results = [];
        const proof = {
            scope: local
                ? 'supplementary-builtin-UI-not-exact-template-acceptance'
                : 'formal-UI',
            runId,
            marker,
            target,
            lockChecksum: process.env.STOREFRONT_E2E_LOCK_CHECKSUM || null,
            checks: {},
        };
        const resultFile = path.join(
            process.env.STOREFRONT_E2E_LAUNCH_RESULTS,
            `${target.id}.json`,
        );
        const capture = async (name, operation) => {
            console.log('D1 step ' + target.id + '/' + name);
            try {
                const details = await test.step(name, operation);
                proof.checks[name] = { status: 'passed', ...(details || {}) };
                if (!local)
                    results.push({
                        id: `${target.id}/${name}`,
                        status:
                            details?.coverageComplete === false
                                ? 'not-run'
                                : 'passed',
                        reason:
                            details?.coverageComplete === false
                                ? 'Partial subchecks executed; full required breadth remains unimplemented'
                                : 'Actual authenticated UI/API assertions',
                        artifacts: [resultFile],
                    });
                return true;
            } catch (error) {
                proof.checks[name] = { status: 'failed' };
                if (!local)
                    results.push({
                        id: `${target.id}/${name}`,
                        status: 'failed',
                        reason: 'Actual assertion failed; inspect sanitized browser evidence',
                        artifacts: [resultFile],
                    });
                throw error;
            }
        };
        try {
            await page.goto('/d/workspaces');
            const form = page.locator('form').filter({
                has: page.getByRole('button', {
                    name: '创建',
                    exact: true,
                }),
            });
            await form.getByLabel('工作区名称', { exact: true }).fill(marker);
            await form
                .getByRole('button', { name: '创建', exact: true })
                .click();
            await expect(
                page.getByRole('button', {
                    name: `${marker} · 当前工作区`,
                    exact: true,
                }),
            ).toBeVisible();
            await page
                .getByRole('link', { name: '使用向导创建网站 →', exact: true })
                .click();
            const catalog = await page.evaluate(async () => {
                const r = await window.bcms.sdk.send({
                    url: '/api/v4/presets/catalog',
                });
                return {
                    available: r.publicRegistryAvailable,
                    items: r.items.map((x) => ({
                        id: x.id,
                        version: x.version,
                        sourceCommit: x.sourceCommit || null,
                        manifestChecksum: x.manifestChecksum || null,
                        imageDigest: x.imageDigest || null,
                        previewArtifactDigest: x.previewArtifactDigest || null,
                        previewBundleDigest: x.previewBundleDigest || null,
                    })),
                };
            });
            proof.catalog = catalog;
            const exact = catalog.items.find(
                (x) =>
                    x.id === target.id &&
                    x.version === target.version &&
                    x.sourceCommit &&
                    x.manifestChecksum,
            );
            if (!exact)
                results.push({
                    id: `${target.id}/CREATE`,
                    status: 'blocked',
                    reason: `Genuine public ${target.id}@${target.version} catalog record unavailable; builtin/local projections cannot satisfy this case`,
                    artifacts: [resultFile],
                });
            if (!local && !exact) return;
            if (!local) {
                const lock = JSON.parse(
                        await readFile(process.env.E2E_PLATFORM_LOCK, 'utf8'),
                    ),
                    pinned = lock.templates.find(
                        (t) =>
                            t.id === target.id && t.version === target.version,
                    );
                expect(exact.sourceCommit).toBe(
                    lock.repositories.templates.commit,
                );
                for (const key of ['manifestChecksum', 'imageDigest'])
                    expect(exact[key]).toBe(pinned[key]);
            }
            await capture('CREATE', async () => {
                const selected = local
                    ? { id: 'aeroframe', version: '1.0.0', name: 'AeroFrame' }
                    : {
                          ...target,
                          name:
                              target.id === 'aeroframe'
                                  ? 'AeroFrame'
                                  : 'FireGuard',
                      };
                await page
                    .locator('.site-setup-template')
                    .filter({ hasText: selected.name })
                    .filter({ hasText: `版本 ${selected.version}` })
                    .click();
                await page
                    .getByRole('button', { name: '下一步', exact: true })
                    .click();
                await page.getByLabel('网站名称', { exact: true }).fill(marker);
                const request = page.waitForRequest(
                    (r) =>
                        r.method() === 'POST' &&
                        new URL(r.url()).pathname ===
                            '/api/v4/workspaces/current/sites',
                );
                await page
                    .getByRole('button', { name: '下一步', exact: true })
                    .click();
                const body = (await request).postDataJSON();
                expect(body.name).toBe(marker);
                expect(body.requestKey).toMatch(
                    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/,
                );
                proof.requestKey = body.requestKey;
                await page
                    .getByRole('checkbox', { name: /加入示例内容/ })
                    .check();
                await page
                    .getByRole('button', { name: '创建网站草稿', exact: true })
                    .click();
                await expect(
                    page.getByText('内容已准备，继续完善你的资料', {
                        exact: true,
                    }),
                ).toBeVisible({ timeout: 45000 });
                await expect
                    .poll(
                        async () =>
                            page.evaluate(async () => {
                                const r = await window.bcms.sdk.send({
                                    url: '/api/v4/presets/site',
                                });
                                return r.site?.provisioning?.status;
                            }),
                        { timeout: 45000 },
                    )
                    .toBe('ready');
                const site = await page.evaluate(async () => {
                    const sdk = window.bcms.sdk,
                        r = await sdk.send({ url: '/api/v4/presets/site' });
                    return {
                        cmsWorkspaceId: sdk.context.context.workspaceId,
                        cmsSiteId: r.site._id,
                        presetId: r.site.presetId,
                        presetVersion: r.site.presetVersion,
                        provisioning: r.site.provisioning,
                    };
                });
                expect(site.presetId).toBe(selected.id);
                expect(site.presetVersion).toBe(selected.version);
                proof.site = site;
                return {
                    automaticProvisioning: true,
                    stableRequestKey: true,
                    selected,
                };
            });
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
                await page
                    .getByRole('tab', { name: '页面信息', exact: true })
                    .click();
                await page
                    .getByLabel('网站名称', { exact: true })
                    .fill(marker + ' Brand');
                await save(page);
                await openContent(page, 'product');
                await page.locator('#studio-field-price').fill('127');
                await save(page);
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
                        new URL(r.url()).pathname ===
                            '/api/v4/media/create/file',
                );
                await upload
                    .getByRole('button', { name: '创建', exact: true })
                    .click();
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
                await picker
                    .getByRole('button', { name: '完成', exact: true })
                    .click();
                await save(page);
                await page.reload();
                await expect(field).toContainText(filename);
                return { mediaId: media._id, uploadedThroughPicker: true };
            });
            await capture('SEO', async () => {
                await page
                    .getByRole('tab', { name: '页面信息', exact: true })
                    .click();
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
                await page
                    .locator('.studio-page-blueprints button')
                    .first()
                    .click();
                await expect(workspace(page)).toHaveCount(1);
                await page
                    .getByRole('tab', { name: '页面内容', exact: true })
                    .click();
                await page
                    .locator(
                        '.studio-workspace-content [contenteditable="true"]',
                    )
                    .first()
                    .fill(marker + ' Contact');
                await page
                    .getByRole('tab', { name: '页面信息', exact: true })
                    .click();
                await page
                    .getByLabel('页面名称', { exact: true })
                    .fill(marker + ' Contact');
                await page
                    .getByLabel(/^访问路径/)
                    .fill('/pages/d1-' + target.id);
                const createdResponse = page.waitForResponse(
                    (r) =>
                        r.request().method() === 'POST' &&
                        new URL(r.url()).pathname === '/api/v4/studio/pages',
                );
                await page
                    .getByRole('button', { name: '保存草稿', exact: true })
                    .click();
                const receipt = await createdResponse;
                expect(receipt.status()).toBe(200);
                await expect(
                    page.getByRole('button', { name: '保存草稿', exact: true }),
                ).toBeDisabled();
                const current = await state(page);
                expect(current.site.pages.length).toBe(before + 1);
                expect(
                    current.site.pages.some(
                        (p) => p.path === '/pages/d1-' + target.id,
                    ),
                ).toBe(true);
            });
            await capture('NAVIGATION', async () => {
                await page
                    .getByRole('tab', { name: '页面信息', exact: true })
                    .click();
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
                const child = navigation
                    .locator('.studio-navigation-item')
                    .filter({
                        has: page.locator(
                            `.studio-navigation-path:text-is("/pages/d1-${target.id}")`,
                        ),
                    });
                await child
                    .getByRole('combobox')
                    .selectOption({ label: marker + ' Menu' });
                await save(page);
                const current = await state(page);
                expect(JSON.stringify(current.site.navigation)).toContain(
                    marker + ' Menu',
                );
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
                await expect(rich.locator('strong')).toContainText(
                    marker + ' rich',
                );
                await expect(rich.locator('ul li')).toContainText(
                    marker + ' list',
                );
                await save(page);
                await page.reload();
                await expect(rich.locator('strong')).toContainText(
                    marker + ' rich',
                );
                await expect(rich.locator('ul li')).toContainText(
                    marker + ' list',
                );
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
                await openContent(page);
                return {
                    richMarksAndListsRetained: true,
                    coverageComplete: false,
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
                        enabled: true,
                        navigation: true,
                        layoutDocument: {
                            version: 1,
                            mode: 'structured',
                            root: [],
                        },
                    };
                    try {
                        await sdk.studio.savePage(p.key, request);
                        return 200;
                    } catch (error) {
                        return error.status;
                    }
                });
                expect(denied).toBe(400);
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
                await page
                    .getByRole('tab', { name: '页面信息', exact: true })
                    .click();
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
            // An unavailable exact renderer is an external prerequisite, never a fake canvas.
            const runtime = await page.evaluate(async () => {
                const sdk = window.bcms.sdk,
                    s = await sdk.send({ url: '/api/v4/presets/site' });
                return sdk.send({
                    url:
                        '/api/v4/storefront/preview-runtime?' +
                        new URLSearchParams({
                            templateId: s.site.presetId,
                            templateVersion: s.site.presetVersion,
                        }),
                });
            });
            proof.previewStatus = runtime.status;
            if (runtime.status === 'ready') {
                const heroInput = await openHero(page);
                await capture('LIVE_UNSAVED_PREVIEW', async () => {
                    const writes = [];
                    const observe = (r) => {
                        if (
                            ['POST', 'PUT', 'DELETE'].includes(r.method()) &&
                            new URL(r.url()).pathname.startsWith('/api/v4/')
                        )
                            writes.push(new URL(r.url()).pathname);
                    };
                    page.on('request', observe);
                    const unsaved = marker + ' unsaved';
                    await heroInput.fill(unsaved);
                    const start = Date.now();
                    await expect(
                        page
                            .frameLocator('iframe[title="草稿预览"]')
                            .getByText(unsaved, { exact: true }),
                    ).toBeVisible({ timeout: 1000 });
                    const latencyMs = Date.now() - start;
                    expect(latencyMs).toBeLessThanOrEqual(1000);
                    expect(
                        writes.every((p) => p === '/api/v4/studio/preview'),
                    ).toBe(true);
                    page.off('request', observe);
                    await heroInput.fill(marker);
                    return { latencyMs };
                });
                await capture('PREVIEW_RACE', async () => {
                    let release, arrived;
                    const gate = new Promise((resolve) => {
                        release = resolve;
                    });
                    const requested = new Promise((resolve) => {
                        arrived = resolve;
                    });
                    const delayed = async (route) => {
                        const response = await route.fetch();
                        arrived();
                        await gate;
                        await route.fulfill({ response }).catch(() => {});
                    };
                    await page.route('**/api/v4/studio/preview', delayed, {
                        times: 1,
                    });
                    try {
                        await page
                            .locator('#studio-field-headline')
                            .fill(marker + ' older');
                        await requested;
                        await page
                            .locator('#studio-field-headline')
                            .fill(marker + ' newest');
                        const canvas = page.frameLocator(
                            'iframe[title="草稿预览"]',
                        );
                        await expect(
                            canvas.getByText(marker + ' newest', {
                                exact: true,
                            }),
                        ).toBeVisible();
                        release();
                        await page.unroute('**/api/v4/studio/preview', delayed);
                        await expect(
                            canvas.getByText(marker + ' newest', {
                                exact: true,
                            }),
                        ).toBeVisible();
                        await expect(
                            canvas.getByText(marker + ' older', {
                                exact: true,
                            }),
                        ).toHaveCount(0);
                        await page.route(
                            '**/api/v4/studio/preview',
                            (route) =>
                                route.fulfill({
                                    status: 503,
                                    contentType: 'application/json',
                                    body: '{"message":"Preview unavailable"}',
                                }),
                            { times: 1 },
                        );
                        await page
                            .locator('#studio-field-headline')
                            .fill(marker + ' recovered');
                        await page
                            .getByRole('button', {
                                name: '重试预览',
                                exact: true,
                            })
                            .click();
                        await expect(
                            canvas.getByText(marker + ' recovered', {
                                exact: true,
                            }),
                        ).toBeVisible();
                        await page
                            .locator('#studio-field-headline')
                            .fill(marker);
                    } finally {
                        release();
                        await page.unroute('**/api/v4/studio/preview', delayed);
                    }
                    return {
                        coverageComplete: false,
                        delayedRealResponseRejected: true,
                        serviceFailureRecoverable: true,
                    };
                });
                for (const [name, size] of [
                    ['PREVIEW_DESKTOP', { width: 1440, height: 900 }],
                    ['PREVIEW_MOBILE', { width: 390, height: 844 }],
                ])
                    await capture(name, async () => {
                        await page.setViewportSize(size);
                        if (name === 'PREVIEW_MOBILE')
                            await page
                                .getByRole('tab', {
                                    name: '查看画布',
                                    exact: true,
                                })
                                .click();
                        await expect(
                            page
                                .frameLocator('iframe[title="草稿预览"]')
                                .locator('main'),
                        ).toBeVisible();
                        return { dimensions: size };
                    });
            } else
                for (const name of [
                    'LIVE_UNSAVED_PREVIEW',
                    'PREVIEW_DESKTOP',
                    'PREVIEW_MOBILE',
                    'PREVIEW_RACE',
                ])
                    if (!local)
                        results.push({
                            id: `${target.id}/${name}`,
                            status: 'blocked',
                            reason: 'Exact installed preview renderer unavailable',
                            artifacts: [resultFile],
                        });
            await page.setViewportSize({ width: 1440, height: 900 });
            if (!local) {
                const lock = JSON.parse(
                    await readFile(process.env.E2E_PLATFORM_LOCK, 'utf8'),
                );
                const pinned = lock.templates.find(
                    (t) => t.id === target.id && t.version === target.version,
                );
                const otherMarker = `D1-${runId}-${target.id === 'aeroframe' ? 'fireguard' : 'aeroframe'}`;
                const send = (request) =>
                    page.evaluate(
                        async (request) => window.bcms.sdk.send(request),
                        request,
                    );
                const { readAndVerifyPublication } = await import(
                    './publication-observation.mjs'
                );
                const { verifyPublicResponse } = await import(
                    './launch-publication.mjs'
                );
                let firstPublication, latestPublication;
                const publish = async () => {
                    await page.goto('/d/studio?section=publish');
                    await page
                        .getByRole('button', {
                            name: '校验待发布内容',
                            exact: true,
                        })
                        .click();
                    const response = page.waitForResponse(
                        (r) =>
                            new URL(r.url()).pathname ===
                                '/api/v4/presets/releases/publish' &&
                            r.request().method() === 'POST',
                    );
                    await page
                        .getByRole('button', {
                            name: '发布新版本',
                            exact: true,
                        })
                        .click();
                    const receipt = await (await response).json();
                    expect(receipt.operationId).toBeTruthy();
                    let operation;
                    await expect
                        .poll(
                            async () => {
                                operation = await send({
                                    url:
                                        '/api/v4/presets/releases/gateway/operations/' +
                                        encodeURIComponent(receipt.operationId),
                                });
                                return operation.status;
                            },
                            { timeout: 90000 },
                        )
                        .toBe('ready');
                    const gateway = await send({
                        url: '/api/v4/presets/releases/gateway',
                    });
                    const expected = {
                        releaseId: receipt.releaseId,
                        activeRevision: operation.activeRevision,
                        templateId: target.id,
                        templateVersion: target.version,
                        workspaceId: proof.site.cmsWorkspaceId,
                        siteId: proof.site.cmsSiteId,
                        siteUrl: gateway.siteUrl,
                        marker,
                        imageDigest: pinned.imageDigest,
                        manifestChecksum: pinned.manifestChecksum,
                        sourceCommit: lock.repositories.templates.commit,
                    };
                    const observed = await readAndVerifyPublication(
                        send,
                        expected,
                    );
                    const responsePublic = await fetch(expected.siteUrl, {
                            signal: AbortSignal.timeout(15000),
                        }),
                        html = await responsePublic.text();
                    verifyPublicResponse({
                        status: responsePublic.status,
                        body: html,
                        marker,
                        otherMarker,
                    });
                    return {
                        releaseId: observed.releaseId,
                        activeRevision: observed.activeRevision,
                        siteUrl: observed.siteUrl,
                        expected,
                    };
                };
                await capture('DOMAINS', async () => {
                    const list = await send({ url: '/api/v4/site-domains' });
                    expect(list.items.length).toBeGreaterThan(0);
                    const selected = list.items.find(
                        (item) => item.platformOwned,
                    );
                    expect(selected).toBeTruthy();
                    const checked = await send({
                        url: `/api/v4/site-domains/${selected._id}/check`,
                        method: 'POST',
                        data: {},
                    });
                    expect(checked.ready).toBe(true);
                    await page.goto('/d/domains');
                    await expect(
                        page
                            .getByText(selected.hostname, { exact: true })
                            .first(),
                    ).toBeVisible();
                });
                await capture('PUBLISH', async () => {
                    firstPublication = latestPublication = await publish();
                    return firstPublication;
                });
                await capture('UPDATE', async () => {
                    await openContent(page, 'product');
                    await page.locator('#studio-field-price').fill('173');
                    await save(page);
                    latestPublication = await publish();
                    expect(latestPublication.releaseId).not.toBe(
                        firstPublication.releaseId,
                    );
                    expect(latestPublication.activeRevision).toBeGreaterThan(
                        firstPublication.activeRevision,
                    );
                    return latestPublication;
                });
                await capture('ROLLBACK', async () => {
                    await page.goto('/d/studio?section=publish');
                    const response = page.waitForResponse(
                        (r) =>
                            new URL(r.url()).pathname ===
                                '/api/v4/presets/releases/rollback' &&
                            r.request().method() === 'POST',
                    );
                    await page
                        .getByRole('row')
                        .filter({ hasText: firstPublication.releaseId })
                        .getByRole('button', {
                            name: '恢复此版本',
                            exact: true,
                        })
                        .click();
                    const receipt = await (await response).json();
                    let operation;
                    await expect
                        .poll(
                            async () => {
                                operation = await send({
                                    url:
                                        '/api/v4/presets/releases/gateway/operations/' +
                                        encodeURIComponent(receipt.operationId),
                                });
                                return operation.status;
                            },
                            { timeout: 90000 },
                        )
                        .toBe('ready');
                    const observed = await readAndVerifyPublication(send, {
                        ...firstPublication.expected,
                        activeRevision: operation.activeRevision,
                    });
                    expect(observed.releaseId).toBe(firstPublication.releaseId);
                    const responsePublic = await fetch(
                            firstPublication.siteUrl,
                        ),
                        html = await responsePublic.text();
                    verifyPublicResponse({
                        status: responsePublic.status,
                        body: html,
                        marker,
                        otherMarker,
                    });
                    return {
                        releaseId: observed.releaseId,
                        activeRevision: observed.activeRevision,
                    };
                });
            }
            proof.supplementaryCompleted = true;
        } finally {
            await mkdir(path.dirname(resultFile), {
                recursive: true,
                mode: 0o700,
            });
            proof.cases = completeAcceptance(results).filter((x) =>
                x.id.startsWith(target.id + '/'),
            );
            const timelinePath = info.outputPath('interaction-timeline.json');
            await writeFile(
                timelinePath,
                JSON.stringify(traceSteps.finish(), null, 2),
                { mode: 0o600 },
            );
            await info.attach('interaction-timeline', {
                path: timelinePath,
                contentType: 'application/json',
            });
            await writeFile(resultFile, JSON.stringify(proof, null, 2), {
                mode: 0o600,
            });
            await info.attach('launch-proof', {
                path: resultFile,
                contentType: 'application/json',
            });
            if (!page.isClosed())
                await page.screenshot({
                    path: info.outputPath('launch-sanitized.png'),
                    fullPage: true,
                    mask: [
                        page.locator(
                            'input[type="password"],input[type="email"],[data-e2e-private]',
                        ),
                        page.getByText(process.env.STOREFRONT_E2E_EMAIL, {
                            exact: false,
                        }),
                    ],
                });
        }
    });
