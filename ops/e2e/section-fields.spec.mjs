import { test, expect } from './browser-fixture.mjs';
const editor = '/d/studio?section=pages&pageKey=home';
const title = page => page.getByLabel('标题 *', { exact: true });
async function openEditor(page) {
    await page.goto(editor, { waitUntil: 'domcontentloaded' });
    await page.locator('.studio-visual-node-button').filter({ hasText: '首页主视觉' }).click({ timeout: 10000 });
    await expect(title(page)).toBeVisible();
    await expect(page.locator('.studio-visual-preview iframe')).toBeVisible();
    await expect(page.frameLocator('.studio-visual-preview iframe').locator('h1')).toBeVisible();
}
async function keyboardText(page, locator, value) {
    await locator.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(value); await page.keyboard.press('Tab');
}
test('keyboard controls update the real exact-version draft, retain node IDs and survive save/refresh', async ({ page, installation }, info) => {
    await openEditor(page);
    const descriptor = await page.evaluate(async () => {
        const site = (await window.bcms.sdk.studio.getSite()).site;
        return window.bcms.sdk.send({ url: `/api/v4/storefront/preview-runtime?templateId=${site.presetId}&templateVersion=${site.presetVersion}` });
    });
    expect(descriptor.runtime.templateId).toBe(installation.templateId);
    expect(descriptor.runtime.templateVersion).toBe(installation.templateVersion);
    expect(new URL(descriptor.runtime.url).pathname).toBe(`/preview/${installation.templateId}/${installation.templateVersion}/`);
    const frame = page.frameLocator('.studio-visual-preview iframe');
    const originalLayout = await page.evaluate(async () => JSON.stringify((await window.bcms.sdk.studio.getSite()).site.pages.find(page => page.key === 'home').layoutDocument));
    const headline = `B4 keyboard ${installation.templateId} ${info.project.name}`;
    await keyboardText(page, title(page), headline);
    await expect(frame.locator('h1')).toHaveText(headline);
    expect(await page.evaluate(async () => JSON.stringify((await window.bcms.sdk.studio.getSite()).site.pages.find(page => page.key === 'home').layoutDocument))).toBe(originalLayout);
    const toggle = page.getByLabel('显示按钮', { exact: true });
    await toggle.focus(); await page.keyboard.press('Space');
    await expect(page.getByLabel('按钮链接 *', { exact: true })).toBeHidden();
    await expect(frame.locator('[data-section-type="hero"] a[class*="button--primary"]')).toHaveCount(0);
    await page.keyboard.press('Space');
    await keyboardText(page, page.getByLabel('按钮链接 *', { exact: true }), '/collections');
    await page.getByLabel('图片', { exact: true }).focus(); await page.keyboard.press('Enter');
    const image = page.locator('.studio-section-fields .studio-media-grid button').filter({ hasText: 'B4 own image.png' });
    if (await image.getAttribute('aria-pressed') === 'true') { await image.focus(); await page.keyboard.press('Enter'); await page.getByLabel('图片', { exact: true }).focus(); await page.keyboard.press('Enter'); }
    await image.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.studio-section-fields .studio-selected-file')).toContainText('B4 own image.png');
    await page.evaluate(identity => {
        // A sibling/parent source cannot impersonate the selected renderer.
        window.postMessage({ type: 'studio:node-selected', protocolVersion: 1, ...identity, pageKey: 'home', nodeId: 'section-feature-2', nodeType: 'feature' }, location.origin);
        const frame = document.querySelector('.studio-visual-preview iframe');
        // Even the actual parent cannot select with a mismatched renderer identity.
        frame.contentWindow.postMessage({ type: 'studio:select-node', protocolVersion: 1, ...identity, templateVersion: '0.0.0', pageKey: 'home', nodeId: 'section-feature-2', nodeType: 'feature' }, new URL(frame.src).origin);
    }, { templateId: installation.templateId, templateVersion: installation.templateVersion });
    await expect(title(page)).toBeVisible();
    await expect(frame.locator('[data-section-type="feature"][data-studio-selected]')).toHaveCount(0);
    // Real canvas producer -> existing guarded parent consumer -> correct panel.
    await frame.locator('[data-section-type="feature"]').first().click();
    await expect(page.getByLabel('引导文字', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '上移 特色介绍', exact: true }).focus(); await page.keyboard.press('Enter');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v4/studio/pages/home' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存页面设置', exact: true }).focus(); await page.keyboard.press('Enter');
    expect((await saved).status()).toBe(200);
    await page.reload(); await expect(frame.locator('h1')).toHaveText(headline);
    const layout = await page.evaluate(async () => (await window.bcms.sdk.studio.getSite()).site.pages.find(page => page.key === 'home').layoutDocument);
    expect(layout.root.map(node => node.id)).toEqual(['section-feature-2', 'section-hero-1']);
    expect(layout.root.find(node => node.type === 'hero').props).toMatchObject({ title: headline, showButton: true, buttonHref: '/collections', image: { _id: process.env.STOREFRONT_E2E_OWN_MEDIA } });
    expect(await page.locator('textarea[aria-label="区块属性 JSON"]').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.studio-visual-node-button').filter({ hasText: '首页主视觉' }).click();
    await title(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('section-controls.png'), mask: [page.getByText(process.env.STOREFRONT_E2E_EMAIL, { exact: false })] });
});
test('invalid required input focuses linked summary without saving or stealing input focus', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: '首页主视觉', exact: false }).filter({ has: page.locator('small') }).click();
    await title(page).fill('');
    await expect(title(page)).toBeFocused();
    await expect(title(page)).toHaveAttribute('aria-invalid', 'true');
    let saves = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/v4/studio/pages/home' && request.method() === 'POST') saves++; });
    await page.getByRole('button', { name: '保存页面设置', exact: true }).click();
    const summary = page.locator('.studio-section-error-summary');
    await expect(summary).toBeFocused(); await summary.getByRole('link').first().click(); await expect(title(page)).toBeFocused();
    expect(saves).toBe(0);
    await title(page).fill('Repaired title');
    await expect(title(page)).toHaveAttribute('aria-invalid', 'false');
});
test('server rejects forged authoritative layout media/scalars and leaves the draft unchanged', async ({ page }) => {
    await openEditor(page);
    const results = await page.evaluate(async foreignMedia => {
        const sdk = window.bcms.sdk;
        const before = (await sdk.studio.getSite()).site;
        const original = before.pages.find(page => page.key === 'home');
        const results = [];
        for (const patch of [{ image: { _id: foreignMedia } }, { image: { _id: 'unknown-image' } }, { title: ' ' }, { showButton: 'false' }, { showButton: true, buttonHref: 'javascript:alert(1)' }]) {
            const page = structuredClone(original);
            Object.assign(page.layoutDocument.root.find(node => node.type === 'hero').props, patch);
            // Keep duplicate sectionConfigs benign: only the winning layout may be trusted.
            page.sectionConfigs = original.layoutDocument.root.map(node => ({ type: node.type, enabled: node.enabled, data: node.props }));
            try { await sdk.studio.savePage('home', { expectedUpdatedAt: before.updatedAt, title: page.title, path: page.path, seoTitle: page.seoTitle, seoDescription: page.seoDescription, sections: page.sections, sectionConfigs: page.sectionConfigs, layoutDocument: page.layoutDocument, entryId: page.entryId, enabled: page.enabled, navigation: page.navigation }); results.push(200); }
            catch (error) { results.push(error.response?.status || error.status || 0); }
        }
        const after = (await sdk.studio.getSite()).site;
        return { results, unchanged: before.updatedAt === after.updatedAt && JSON.stringify(original.layoutDocument) === JSON.stringify(after.pages.find(page => page.key === 'home').layoutDocument) };
    }, process.env.STOREFRONT_E2E_FOREIGN_MEDIA);
    expect(results.results).toEqual([400, 400, 400, 400, 400]); expect(results.unchanged).toBe(true);
});
test('a real viewer sees read-only controls and cannot save through the API', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'zh-CN', baseURL: process.env.STOREFRONT_E2E_CMS });
    try {
        const page = await context.newPage();
        await page.goto(process.env.STOREFRONT_E2E_CMS);
        await page.evaluate(async selection => window.bcms.sdk.storage.set('selection', selection), { workspaceId: process.env.STOREFRONT_E2E_WORKSPACE_ID, siteId: process.env.STOREFRONT_E2E_SITE_ID });
        const authenticated = await page.evaluate(async credentials => { try { await window.bcms.sdk.auth.login(credentials); return true; } catch { return false; } }, { email: process.env.STOREFRONT_E2E_VIEWER_EMAIL, password: process.env.STOREFRONT_E2E_VIEWER_PASSWORD });
        expect(authenticated).toBe(true);
        const selected = page.waitForURL('**/d/studio', { waitUntil: 'domcontentloaded' });
        await page.evaluate(async selection => window.bcms.sdk.selectContext(selection, '/d/studio'), { workspaceId: process.env.STOREFRONT_E2E_WORKSPACE_ID, siteId: process.env.STOREFRONT_E2E_SITE_ID });
        await selected;
        await openEditor(page); await expect(title(page)).toBeDisabled();
        await expect(page.getByLabel('图片', { exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: '保存页面设置', exact: true })).toBeDisabled();
        const denied = await page.evaluate(async () => { try { await window.bcms.sdk.studio.savePage('home', {}); return false; } catch { return true; } });
        expect(denied).toBe(true);
    } finally { await context.close().catch(() => {}); }
});
