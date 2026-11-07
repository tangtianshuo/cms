import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
export async function createLaunchSite({
    page,
    marker,
    target,
    local,
    proof,
    results = [],
    resultFile = '',
    capture,
    waitProvisioning = true,
}) {
    await page.goto('/d/workspaces');
    const form = page.locator('form').filter({
        has: page.getByRole('button', {
            name: '创建',
            exact: true,
        }),
    });
    await form.getByLabel('工作区名称', { exact: true }).fill(marker);
    await form.getByRole('button', { name: '创建', exact: true }).click();
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
    if (!local && !exact) return false;
    if (!local) {
        const lock = JSON.parse(
                await readFile(process.env.E2E_PLATFORM_LOCK, 'utf8'),
            ),
            pinned = lock.templates.find(
                (t) => t.id === target.id && t.version === target.version,
            );
        expect(exact.sourceCommit).toBe(lock.repositories.templates.commit);
        for (const key of ['manifestChecksum', 'imageDigest'])
            expect(exact[key]).toBe(pinned[key]);
    }
    await capture('CREATE', async () => {
        const selected = local
            ? { id: 'aeroframe', version: '1.0.0', name: 'AeroFrame' }
            : {
                  ...target,
                  name: target.id === 'aeroframe' ? 'AeroFrame' : 'FireGuard',
              };
        await page
            .locator('.site-setup-template')
            .filter({ hasText: selected.name })
            .filter({ hasText: `版本 ${selected.version}` })
            .click();
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.getByLabel('网站名称', { exact: true }).fill(marker);
        const request = page.waitForRequest(
            (r) =>
                r.method() === 'POST' &&
                new URL(r.url()).pathname ===
                    '/api/v4/workspaces/current/sites',
        );
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        const body = (await request).postDataJSON();
        expect(body.name).toBe(marker);
        expect(body.requestKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
        proof.requestKey = body.requestKey;
        await page.getByRole('checkbox', { name: /加入示例内容/ }).check();
        await page
            .getByRole('button', { name: '创建网站草稿', exact: true })
            .click();
        await expect(
            page.getByText('内容已准备，继续完善你的资料', {
                exact: true,
            }),
        ).toBeVisible({ timeout: 45000 });
        if (waitProvisioning)
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

    return true;
}
export async function selectLaunchSite(page, site) {
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.evaluate((site) => {
            void window.bcms.sdk.selectContext(
                { workspaceId: site.cmsWorkspaceId, siteId: site.cmsSiteId },
                '/d/studio',
            );
        }, site),
    ]);
    await page.waitForFunction(
        (site) => window.bcms?.sdk?.context?.context?.siteId === site.cmsSiteId,
        site,
    );
}
