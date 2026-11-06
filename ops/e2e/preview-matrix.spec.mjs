import { test, expect } from './browser-fixture.mjs';
import { readAndVerifyPublication } from './publication-observation.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { savedContractFixture } from './saved-snapshot-fixture.mjs';
import { fileURLToPath } from 'node:url';
const enabled = Boolean(
    process.env.STOREFRONT_E2E_B3_INSTALLED ||
        process.env.STOREFRONT_E2E_FORMAL_PREVIEW,
);
async function details(page, modelKey = 'home') {
    return page.evaluate(async (modelKey) => {
        const sdk = window.bcms.sdk;
        const state = await sdk.studio.getSite();
        const model = state.models.find((item) => item.key === modelKey);
        return {
            workspaceId: sdk.context.context.workspaceId,
            siteId: state.site.id,
            templateId: model.templateId,
            entryId: model.entries[0].id,
            language: state.site.language,
            modelKey,
            pageKey: state.site.pages.find(
                (p) =>
                    p.modelKey === modelKey &&
                    (p.entryId === model.entries[0].id ||
                        (model.singleEntry && !p.entryId)),
            )?.key,
        };
    }, modelKey);
}
async function open(page, id, field = 'headline') {
    await page.goto(
        '/d/studio?' +
            new URLSearchParams(
                Object.fromEntries(
                    Object.entries({
                        section: 'content',
                        ...id,
                        field,
                        panel: 'content',
                    }).filter(([, value]) => value !== undefined),
                ),
            ),
    );
    await expect(
        page.getByRole('region', { name: '内容编辑工作区', exact: true }),
    ).toBeVisible();
}
async function canvas(page, info) {
    if (info.project.name === 'mobile')
        await page.getByRole('tab', { name: '查看画布', exact: true }).click();
    return page.frameLocator('iframe[title="草稿预览"]');
}
async function properties(page, info) {
    if (info.project.name === 'mobile')
        await page.getByRole('tab', { name: '编辑内容', exact: true }).click();
}
async function attach(info, value) {
    const proofPath = info.outputPath('preview-proof.json');
    await writeFile(
        proofPath,
        JSON.stringify(
            {
                templateId:
                    process.env.E2E_SECTION_TEMPLATE ||
                    process.env.STOREFRONT_E2E_TEMPLATE_ID,
                viewport: info.project.name,
                dimensions: info.project.use.viewport,
                lockChecksum: process.env.STOREFRONT_E2E_LOCK_CHECKSUM || null,
                ...value,
            },
            null,
            2,
        ),
    );
    await info.attach('preview-proof', {
        path: proofPath,
        contentType: 'application/json',
    });
}

test.beforeEach(async ({ installation, page }, info) => {
    expect(page.viewportSize()).toEqual(
        info.project.name === 'desktop'
            ? { width: 1440, height: 900 }
            : { width: 390, height: 844 },
    );
    test.skip(
        !enabled,
        'Installed B3 artifacts or an actual formal runtime required',
    );
    expect(installation.templateId).toBe(
        process.env.E2E_SECTION_TEMPLATE ||
            process.env.STOREFRONT_E2E_TEMPLATE_ID,
    );
    expect(installation.templateVersion).toBe(
        installation.templateId === 'aeroframe' ? '1.0.4' : '1.0.1',
    );
});
test('[PREVIEW] exact installed identity, clean CSP, hash asset and complete-site navigation', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    traceSteps.step('editor-open');
    const errors = [];
    page.on('pageerror', () => errors.push('pageerror'));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push('console-error');
    });
    const response = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === '/api/v4/storefront/preview-runtime',
    );
    await page.goto('/d/presets/site-preview');
    const descriptor = await (await response).json();
    expect(descriptor.status).toBe('ready');
    expect(descriptor.runtime.templateId).toBe(installation.templateId);
    expect(descriptor.runtime.templateVersion).toBe(
        installation.templateVersion,
    );
    if (process.env.STOREFRONT_E2E_B3_INSTALLED) {
        const records = JSON.parse(
            await readFile(process.env.STOREFRONT_E2E_B3_INSTALLED, 'utf8'),
        );
        expect(descriptor.runtime.digest).toBe(
            records.find((r) => r.id === installation.templateId).bundleDigest,
        );
    }
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveCount(1);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('main')).toBeVisible();
    if (process.env.STOREFRONT_E2E_EXPECTED_BUNDLE_DIGEST)
        expect(descriptor.runtime.digest).toBe(
            process.env.STOREFRONT_E2E_EXPECTED_BUNDLE_DIGEST,
        );
    if (process.env.STOREFRONT_E2E_EXPECTED_PREVIEW_ORIGIN)
        expect(new URL(descriptor.runtime.url).origin).toBe(
            process.env.STOREFRONT_E2E_EXPECTED_PREVIEW_ORIGIN,
        );
    const health = await fetch(
        new URL('/health-check', descriptor.runtime.url),
    );
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);
    const html = await fetch(descriptor.runtime.url);
    expect(html.status).toBe(200);
    expect(html.headers.get('cache-control')).toBe('no-store');
    expect(html.headers.get('x-robots-tag')).toContain('noindex');
    const csp = html.headers.get('content-security-policy');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('frame-ancestors ' + process.env.STOREFRONT_E2E_CMS);
    expect(csp).toContain("img-src 'self' data: https:");
    const text = await html.text();
    const assetPath = text.match(
        /(?:src|href)="([^" ]*\/_nuxt\/[^" ]+\.(?:js|css))"/,
    )[1];
    const asset = await fetch(new URL(assetPath, descriptor.runtime.url));
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    if (info.project.name === 'mobile')
        await frame
            .getByRole('button', {
                name: installation.templateId === 'aeroframe' ? 'Menu' : '菜单',
                exact: true,
            })
            .click();
    const link =
        info.project.name === 'mobile'
            ? frame.locator('#mobile-navigation a[href$="/collections"]')
            : frame.getByRole('navigation').locator('a[href$="/collections"]');
    await expect(link).toBeVisible();
    await link.click();
    await expect(frame.locator('[data-section-type="grid"]')).toBeVisible();
    const home = frame
        .locator('a[href="' + new URL(descriptor.runtime.url).pathname + '"]')
        .first();
    await home.click();
    await expect(frame.locator('[data-section-type="hero"]')).toBeVisible();
    expect(errors).toEqual([]);
    traceSteps.step('canvas-ready');
    await attach(info, {
        case: 'PREVIEW',
        identity: descriptor.runtime,
        cleanCsp: true,
        hashAsset200: true,
        twoWayNavigation: true,
    });
});

test('[LIVE_UNSAVED_PREVIEW] unsaved headline reaches canvas within one second without saving or public leakage', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    await page.evaluate(async () => {
        const sdk = window.bcms.sdk,
            state = await sdk.studio.getSite(),
            p = state.site.pages.find((p) => p.key === 'home'),
            layoutDocument = structuredClone(p.layoutDocument);
        delete layoutDocument.root.find((n) => n.type === 'hero').props.title;
        await sdk.studio.savePage(p.key, {
            expectedUpdatedAt: state.site.updatedAt,
            title: p.title,
            path: p.path,
            seoTitle: p.seoTitle,
            seoDescription: p.seoDescription,
            sections: p.sections,
            layoutDocument,
            entryId: p.entryId,
            enabled: true,
            navigation: true,
        });
    });
    const id = await details(page);
    await open(page, id);
    const input = page.locator('#studio-field-headline');
    await expect(input).toBeVisible();
    const writes = [];
    page.on('request', (r) => {
        const path = new URL(r.url()).pathname;
        if (
            ['POST', 'PUT', 'DELETE'].includes(r.method()) &&
            path.startsWith('/api/v4/')
        )
            writes.push(path);
    });
    const marker =
        'PREVIEW-DRAFT-' +
        installation.templateId +
        '-' +
        info.project.name +
        '-' +
        Date.now();
    traceSteps.step('draft-input');
    await input.fill(marker);
    const start = performance.now();
    const frame = await canvas(page, info);
    await expect(frame.getByText(marker, { exact: true })).toBeVisible({
        timeout: 1000,
    });
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((path) => path === '/api/v4/studio/preview')).toBe(
        true,
    );
    const saved = await page.evaluate(
        async (id) =>
            JSON.stringify(
                await window.bcms.sdk.entry.get({
                    templateId: id.templateId,
                    entryId: id.entryId,
                    skipCache: true,
                }),
            ),
        id,
    );
    expect(saved).not.toContain(marker);
    const siteUrl =
        process.env.STOREFRONT_E2E_SITE_URL ||
        process.env.STOREFRONT_E2E_LOCAL_RUNTIME_URL;
    expect(siteUrl).toBeTruthy();
    expect(await (await fetch(siteUrl)).text()).not.toContain(marker);
    traceSteps.step('public-compare');
    await attach(info, {
        case: 'LIVE_UNSAVED_PREVIEW',
        elapsedMs,
        onlyPreviewWrites: true,
        savedAndRuntimeExcludeDraft: true,
        comparisonScope: process.env.STOREFRONT_E2E_SITE_URL
            ? 'configured-public-site'
            : 'isolated-saved-snapshot-runtime',
    });
});

test('[NAVIGATION] page selection switches the actual template canvas', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    await page.goto('/d/studio?section=pages&pageKey=collections');
    traceSteps.step('page-switch');
    await expect(
        (await canvas(page, info)).locator('[data-section-type="grid"]'),
    ).toBeVisible();
    await page.goto('/d/studio?section=pages&pageKey=home');
    await expect(
        (await canvas(page, info)).locator('[data-section-type="hero"]'),
    ).toBeVisible();
    await attach(info, { case: 'NAVIGATION', twoWayPageTargets: true });
});

test('[MEDIA] authorized real uploaded image loads HTTPS bytes and decoded pixels under strict CSP', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    const cspErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') cspErrors.push('console-error');
    });
    const imageResponses = [];
    page.on('response', (response) => {
        const url = new URL(response.url());
        if (
            /^\/api\/v4\/media\/[^/]+\/bin\/image$/.test(url.pathname) &&
            (!process.env.STOREFRONT_E2E_MEDIA_ORIGIN ||
                url.origin === process.env.STOREFRONT_E2E_MEDIA_ORIGIN)
        )
            imageResponses.push({
                status: response.status(),
                contentType: response.headers()['content-type'],
            });
    });
    const id = await details(page, 'content-page');
    await open(page, id, 'cover');
    // The field focus ID identifies the actual media-picker button.
    const cover = page.locator('#studio-field-cover');
    await cover.click();
    const dialog = page.getByRole('dialog', {
        name: '媒体选择器',
        exact: true,
    });
    await expect(dialog.locator('img[alt="B4 foreign image.png"]')).toHaveCount(
        0,
    );
    await dialog
        .locator('[bcms-media-data]')
        .filter({ has: page.locator('img[alt="B4 own image.png"]') })
        .locator('..')
        .click();
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    traceSteps.step('media-select');
    const frame = await canvas(page, info);
    const image = frame.locator('main img').first();
    await expect(image).toBeVisible();
    await expect
        .poll(() =>
            image.evaluate(async (img) => {
                try {
                    await img.decode();
                } catch {
                    return false;
                }
                return (
                    img.complete &&
                    img.naturalWidth > 0 &&
                    img.naturalHeight > 0
                );
            }),
        )
        .toBe(true);
    const proof = await image.evaluate((img) => ({
        protocol: new URL(img.currentSrc).protocol,
        width: img.naturalWidth,
        height: img.naturalHeight,
    }));
    expect(proof.protocol).toBe('https:');
    const http = await image.evaluate(async (img) => {
        const copy = new Image();
        copy.crossOrigin = 'anonymous';
        copy.src = img.currentSrc;
        await copy.decode();
        const canvas = document.createElement('canvas');
        canvas.width = copy.naturalWidth;
        canvas.height = copy.naturalHeight;
        canvas.getContext('2d').drawImage(copy, 0, 0);
        return [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data];
    });
    expect(http).toHaveLength(4);
    expect(http[3]).toBeGreaterThan(0);
    await page.locator('iframe[title="草稿预览"]').screenshot({
        path: info.outputPath('https-authorized-image-pixels.png'),
    });
    expect(cspErrors).toEqual([]);
    expect(
        imageResponses.some(
            (item) =>
                item.status === 200 && item.contentType?.startsWith('image/'),
        ),
    ).toBe(true);
    await attach(info, {
        case: 'MEDIA',
        ...proof,
        pixel: http,
        responses: imageResponses,
        cspErrors,
        ownershipPickerFiltered: true,
        capabilityValuesWithheld: true,
    });
});

test('[STRUCTURED_CONTENT] formatted rich text uses the same unsaved canvas and survives explicit save', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    const id = await details(page, 'content-page');
    await open(page, id, 'body');
    const rich = page.locator('#studio-field-body');
    await expect(rich).toBeVisible();
    const marker = 'B3 RICH ' + info.project.name;
    await rich.fill(marker);
    if (!(await rich.locator('strong').count())) {
        await rich.press('ControlOrMeta+A');
        await rich.press('ControlOrMeta+B');
    }
    traceSteps.step('rich-input');
    const frame = await canvas(page, info);
    await expect(
        frame.locator('strong').filter({ hasText: marker }),
    ).toBeVisible();
    await properties(page, info);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
        page.getByText('草稿已保存。发布更新后才会同步到网站。', {
            exact: true,
        }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator('#studio-field-body strong')).toHaveText(marker);
    await expect(
        (await canvas(page, info))
            .locator('strong')
            .filter({ hasText: marker }),
    ).toBeVisible();
    await attach(info, {
        case: 'STRUCTURED_CONTENT',
        boldDom: true,
        savedRoundtrip: true,
    });
});

test('[TEMPLATE_LAYOUT] uses template mode with exact renderer version on both dimensions', async ({
    page,
    installation,
}, info) => {
    const id = await details(page);
    await open(page, id);
    const layout = await page.evaluate(async () => {
        const s = await window.bcms.sdk.studio.getSite();
        return s.site.pages.find((p) => p.key === 'home').layoutDocument;
    });
    expect(layout.mode).toBe('template');
    const frame = await canvas(page, info);
    await expect(frame.locator('[data-section-type="hero"]')).toBeVisible();
    expect(await page.locator('iframe').count()).toBe(1);
    await attach(info, {
        case: 'TEMPLATE_LAYOUT',
        mode: layout.mode,
        installation,
    });
});

test('[LOCAL_SAVED_RUNTIME] actual saved CMS snapshot renders through the isolated template artifact runtime', async ({
    page,
    installation,
    traceSteps,
}, info) => {
    test.skip(
        !process.env.STOREFRONT_E2E_LOCAL_SNAPSHOT_PATH,
        'Isolated artifact runtime fixture only',
    );
    const id = await details(page);
    await open(page, id);
    const marker =
        'B3 SAVED ' + installation.templateId + ' ' + info.project.name;
    await page.locator('#studio-field-headline').fill(marker);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(
        page.getByText('草稿已保存。发布更新后才会同步到网站。', {
            exact: true,
        }),
    ).toBeVisible();
    traceSteps.step('save');
    const snapshot = await page.evaluate(() =>
        window.bcms.sdk.send({ url: '/api/v4/storefront/site-preview' }),
    );
    expect(
        await (
            await fetch(process.env.STOREFRONT_E2E_LOCAL_RUNTIME_URL)
        ).text(),
    ).not.toContain(marker);
    const contract = await savedContractFixture(snapshot, {
        root: fileURLToPath(new URL('../../', import.meta.url)),
        cms: process.env.STOREFRONT_E2E_CMS,
    });
    await writeFile(
        process.env.STOREFRONT_E2E_LOCAL_SNAPSHOT_PATH,
        JSON.stringify(contract),
        { mode: 0o600 },
    );
    const html = await (
        await fetch(process.env.STOREFRONT_E2E_LOCAL_RUNTIME_URL)
    ).text();
    expect(html).toContain(marker);
    await attach(info, {
        case: 'LOCAL_SAVED_RUNTIME',
        scope: 'isolated-template-artifact-runtime-only',
        snapshotContractVersion: contract.contractVersion,
        gatewayPublication: 'not-run',
        publicHostAcceptance: 'not-run',
    });
});

test('[PUBLISH] actual Gateway release identity matches saved content and the configured public site', async ({
    page,
    installation,
}, info) => {
    const expectedReleaseId = process.env.STOREFRONT_E2E_EXPECTED_RELEASE_ID;
    const marker = process.env.STOREFRONT_E2E_PUBLISHED_MARKER;
    const siteUrl = process.env.STOREFRONT_E2E_SITE_URL;
    test.skip(
        !expectedReleaseId || !marker || !siteUrl,
        'D1 must supply the actual publication result and marker; isolated saved-runtime proof is separate',
    );
    const state = await readAndVerifyPublication(
        (request) =>
            page.evaluate((request) => window.bcms.sdk.send(request), request),
        {
            releaseId: expectedReleaseId,
            activeRevision: Number(
                process.env.STOREFRONT_E2E_EXPECTED_ACTIVE_REVISION,
            ),
            workspaceId: process.env.STOREFRONT_E2E_WORKSPACE_ID,
            siteId: process.env.STOREFRONT_E2E_SITE_ID,
            templateId: installation.templateId,
            templateVersion: installation.templateVersion,
            siteUrl,
            marker,
            imageDigest: process.env.STOREFRONT_E2E_EXPECTED_IMAGE_DIGEST,
            manifestChecksum:
                process.env.STOREFRONT_E2E_EXPECTED_MANIFEST_CHECKSUM,
            sourceCommit: process.env.STOREFRONT_E2E_EXPECTED_SOURCE_COMMIT,
        },
    );
    const response = await fetch(siteUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(marker);
    await attach(info, {
        case: 'PUBLISH',
        expectedReleaseId,
        activeRevision: state.activeRevision,
        snapshotChecksum: state.snapshotChecksum,
        homeContentChecksum: state.publishedHome.contentChecksum,
        markerSha256: createHash('sha256').update(marker).digest('hex'),
        savedAndPublicMarkerMatch: true,
        publicationSource:
            'read-only-authoritative-immutable-release-observation',
    });
});
