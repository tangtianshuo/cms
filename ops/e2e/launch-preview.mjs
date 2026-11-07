import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { openHero, selectHeroField, save } from './launch-workspace.mjs';
import { selectLaunchSite } from './launch-sites.mjs';
import { authorPreviewLanguage } from './launch-language.mjs';
export async function runPreviewScenarios({
    page,
    capture,
    proof,
    marker,
    target,
    local,
    results,
    resultFile,
    peerSite,
    peerMarker,
}) {
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
        expect(peerSite?.cmsSiteId).toBeTruthy();
        expect(peerSite.cmsSiteId).not.toBe(proof.site.cmsSiteId);
        const otherMarker = peerMarker + ' peer saved';
        await selectLaunchSite(page, peerSite);
        await (await openHero(page)).fill(otherMarker);
        await save(page);
        await selectLaunchSite(page, proof.site);
        const languagePlan = await authorPreviewLanguage(
            page,
            marker + ' translated',
        );
        await openHero(page);

        if (!local) {
            const currentLock = JSON.parse(
                await readFile(process.env.E2E_PLATFORM_LOCK, 'utf8'),
            );
            const pinned = currentLock.templates.find(
                (t) => t.id === target.id && t.version === target.version,
            );
            expect(runtime.runtime.digest).toBe(pinned.previewBundleDigest);
            expect(runtime.runtime.templateId).toBe(target.id);
            expect(runtime.runtime.templateVersion).toBe(target.version);
            expect(new URL(runtime.runtime.url).origin).toBe(
                process.env.STOREFRONT_E2E_PREVIEW_ORIGIN,
            );
            proof.previewRuntime = runtime.runtime;
        }
        const heroInput = await openHero(page);
        await expect(heroInput).toBeVisible();
        await expect(page.locator('iframe[title="草稿预览"]')).toHaveAttribute(
            'src',
            new RegExp(
                runtime.runtime.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            ),
        );
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
            expect(writes.every((p) => p === '/api/v4/studio/preview')).toBe(
                true,
            );
            page.off('request', observe);
            await heroInput.fill(marker);
            return { latencyMs };
        });
        await capture('PREVIEW_RACE', async () => {
            let release, arrived, delivered;
            const delivery = new Promise((resolve) => {
                delivered = resolve;
            });
            const gate = new Promise((resolve) => {
                release = resolve;
            });
            const requested = new Promise((resolve) => {
                arrived = resolve;
            });
            const delayed = async (route) => {
                if (
                    !route
                        .request()
                        .postData()
                        ?.includes(marker + ' older')
                )
                    return route.continue();
                const response = await route.fetch();
                arrived();
                await gate;
                try {
                    await route.fulfill({ response });
                    const received = await route.request().response();
                    if (received) await received.finished();
                } catch (error) {
                    if (!route.request().failure()) throw error;
                } finally {
                    delivered();
                }
            };
            await page.route('**/api/v4/studio/preview', delayed);
            try {
                await heroInput.fill(marker + ' older');
                await requested;
                await heroInput.fill(marker + ' newest');
                const canvas = page.frameLocator('iframe[title="草稿预览"]');
                await expect(
                    canvas.getByText(marker + ' newest', {
                        exact: true,
                    }),
                ).toBeVisible();
                release();
                await delivery;
                await page.evaluate(
                    () =>
                        new Promise((resolve) =>
                            requestAnimationFrame(() =>
                                requestAnimationFrame(resolve),
                            ),
                        ),
                );
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
                await heroInput.fill(marker + ' recovered');
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
                await heroInput.fill(marker);
            } finally {
                release();
                await page.unroute('**/api/v4/studio/preview', delayed);
            }
            // A held real response must finish delivery before checking retirement.
            const retiredResponse = async (markerValue, retire, verify) => {
                const field = await openHero(page);
                await expect(
                    page
                        .frameLocator('iframe[title="草稿预览"]')
                        .getByText(marker, { exact: true }),
                ).toBeVisible();
                let release, arrive, finish, failSeen, settlement;
                const held = new Promise((r) => (release = r)),
                    seen = new Promise((r, reject) => {
                        arrive = r;
                        failSeen = reject;
                    }),
                    delivered = new Promise((r) => (finish = r));
                const routeHandler = async (route) => {
                    if (!route.request().postData()?.includes(markerValue))
                        return route.continue();
                    try {
                        const response = await route.fetch({ timeout: 10000 });
                        arrive();
                        await held;
                        await route.fulfill({ response });
                        const received = await route.request().response();
                        if (received) {
                            await received.finished();
                            settlement = 'delivered';
                        } else {
                            expect(route.request().failure()).toBeTruthy();
                            settlement = 'cancelled';
                        }
                    } catch (error) {
                        failSeen(error);
                        if (!route.request().failure()) throw error;
                        settlement = 'cancelled';
                    } finally {
                        finish();
                    }
                };
                await page.route('**/api/v4/studio/preview', routeHandler);
                try {
                    await field.fill(markerValue);
                    await seen;
                    await retire();
                    release();
                    await delivered;
                    await page.evaluate(
                        () =>
                            new Promise((r) =>
                                requestAnimationFrame(() =>
                                    requestAnimationFrame(r),
                                ),
                            ),
                    );
                    await verify();
                    expect(['delivered', 'cancelled']).toContain(settlement);
                    return settlement;
                } finally {
                    release();
                    await page.unroute(
                        '**/api/v4/studio/preview',
                        routeHandler,
                    );
                }
            };
            const languageMarker = marker + ' current language';
            const canvas = () => page.frameLocator('iframe[title="草稿预览"]');
            const assertCurrent = async (wanted, retired, site, language) => {
                await expect(
                    page.locator('iframe[title="草稿预览"]'),
                ).toHaveCount(1);
                await expect(
                    canvas().getByText(wanted, { exact: true }),
                ).toBeVisible();
                await expect(
                    canvas().getByText(retired, { exact: true }),
                ).toHaveCount(0);
                expect(
                    await page.evaluate(
                        () => window.bcms.sdk.context.context.siteId,
                    ),
                ).toBe(site.cmsSiteId);
                expect(new URL(page.url()).searchParams.get('language')).toBe(
                    language,
                );
            };
            const languageSettlement = await retiredResponse(
                marker + ' retired language',
                async () => {
                    await page
                        .getByRole('tab', { name: '页面内容', exact: true })
                        .click();
                    page.once('dialog', (d) => d.accept());
                    await page
                        .getByLabel('内容语言', { exact: true })
                        .selectOption(languagePlan.language);
                    await expect(
                        page.getByLabel('内容语言', { exact: true }),
                    ).toHaveValue(languagePlan.language);
                    const current = await selectHeroField(page);
                    const request = page.waitForRequest(
                        (r) =>
                            r.url().endsWith('/api/v4/studio/preview') &&
                            r.postData()?.includes(languageMarker),
                    );
                    await current.fill(languageMarker);
                    expect((await request).postDataJSON().language).toBe(
                        languagePlan.language,
                    );
                    await assertCurrent(
                        languageMarker,
                        marker + ' retired language',
                        proof.site,
                        languagePlan.language,
                    );
                },
                async () => {
                    await assertCurrent(
                        languageMarker,
                        marker + ' retired language',
                        proof.site,
                        languagePlan.language,
                    );
                },
            );
            page.once('dialog', (d) => d.accept());
            await openHero(page);
            const siteSettlement = await retiredResponse(
                marker + ' retired site',
                async () => {
                    page.once('dialog', (d) => d.accept());
                    await selectLaunchSite(page, peerSite);
                    await openHero(page);
                    await expect(
                        canvas().getByText(otherMarker, { exact: true }),
                    ).toBeVisible();
                },
                async () => {
                    const otherLanguage = await page.evaluate(
                        async () =>
                            (await window.bcms.sdk.studio.getSite()).site
                                .language,
                    );
                    await assertCurrent(
                        otherMarker,
                        marker + ' retired site',
                        peerSite,
                        otherLanguage,
                    );
                },
            );
            await selectLaunchSite(page, proof.site);
            const leaveField = await openHero(page);
            await leaveField.fill(marker + ' keep draft');
            page.once('dialog', (d) => d.dismiss());
            await page
                .getByRole('link', { name: '发布更新', exact: true })
                .click();
            expect(
                await leaveField.evaluate((el) =>
                    'value' in el ? el.value : el.textContent,
                ),
            ).toBe(marker + ' keep draft');
            await expect(
                page
                    .frameLocator('iframe[title="草稿预览"]')
                    .getByText(marker + ' keep draft', { exact: true }),
            ).toBeVisible();
            await leaveField.fill(marker);
            return {
                retiredLanguageAndSite: true,
                currentLanguageCanvas: {
                    language: languagePlan.language,
                    marker: languageMarker,
                    settlement: languageSettlement,
                },
                currentSiteCanvas: {
                    site: peerSite,
                    marker: otherMarker,
                    settlement: siteSettlement,
                },
                unsavedLeavePreserved: true,
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
}
