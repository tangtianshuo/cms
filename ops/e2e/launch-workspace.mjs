import { expect } from '@playwright/test';
const saved = '草稿已保存。发布更新后才会同步到网站。';
export const workspace = (page) =>
    page.getByRole('region', { name: '内容编辑工作区', exact: true });
export async function state(page) {
    return page.evaluate(async () => {
        await window.bcms.sdk.ensureContext();
        return window.bcms.sdk.studio.getSite();
    });
}
export async function openContent(page, modelKey = 'home', language) {
    const id = await page.evaluate(async (modelKey) => {
        const sdk = window.bcms.sdk;
        await sdk.ensureContext();
        const s = await sdk.studio.getSite(),
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
                        ...(language ? { language } : {}),
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
export async function openHero(page, language) {
    await openContent(page, 'home', language);
    return selectHeroField(page);
}
export async function selectHeroField(page) {
    const hero = await page.evaluate(async () => {
        await window.bcms.sdk.ensureContext();
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
export async function save(page) {
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(saved, { exact: true })).toBeVisible();
}
