import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openContent, save, state } from './launch-workspace.mjs';
export async function runPublicationScenarios({
    page,
    capture,
    proof,
    marker,
    target,
    runId,
    local,
}) {
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
        const {
            verifyPublicResponse,
            verifyPublicProduct,
            verifyRollbackRevision,
        } = await import('./launch-publication.mjs');
        let firstPublication, latestPublication;
        const productMarker = marker + ' product ';
        const setProduct = async (price, version) => {
            await openContent(page, 'product');
            await page.locator('#studio-field-price').fill(String(price));
            await page
                .locator('.studio-workspace-content [contenteditable="true"]')
                .first()
                .fill(productMarker + version);
            await save(page);
            const current = await state(page),
                product = current.models.find((m) => m.key === 'product')
                    .entries[0];
            expect(product.fields.price).toEqual([price]);
            const productPage = current.site.pages.find(
                (p) => p.modelKey === 'product',
            );
            const node = productPage.layoutDocument?.root.find(
                (n) => n.type === 'information',
            );
            if (node) {
                await page
                    .getByRole('tab', { name: '区块', exact: true })
                    .click();
                await page
                    .locator('.studio-visual-node-button')
                    .nth(productPage.layoutDocument.root.indexOf(node))
                    .click();
                for (const [key, value] of Object.entries({
                    title: productMarker + version,
                    price: String(price),
                })) {
                    const field = page.locator(
                        '#section-' + node.id + '-' + key,
                    );
                    if (await field.count()) await field.fill(value);
                }
                if (
                    await page
                        .getByRole('button', { name: '保存草稿', exact: true })
                        .isEnabled()
                )
                    await save(page);
            }
            return productPage.path.replace(':slug', product.fields.slug[0]);
        };
        const productPath = await setProduct(127, 'first');
        const verifyProduct = async (
            publication,
            price,
            version,
            replacedPrice,
            oldVersion,
        ) => {
            const url = new URL(productPath, publication.siteUrl);
            const response = await fetch(url, {
                signal: AbortSignal.timeout(15000),
            });
            verifyPublicProduct({
                status: response.status,
                body: await response.text(),
                marker: productMarker + version,
                otherMarker: productMarker + oldVersion,
                price,
                replacedPrice,
            });
            return {
                productUrl: url.href,
                price,
                productMarker: productMarker + version,
            };
        };
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
            const observed = await readAndVerifyPublication(send, expected);
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
            const selected = list.items.find((item) => item.platformOwned);
            expect(selected).toBeTruthy();
            const checked = await send({
                url: `/api/v4/site-domains/${selected._id}/check`,
                method: 'POST',
                data: {},
            });
            expect(checked.ready).toBe(true);
            await page.goto('/d/domains');
            await expect(
                page.getByText(selected.hostname, { exact: true }).first(),
            ).toBeVisible();
        });
        await capture('PUBLISH', async () => {
            firstPublication = latestPublication = await publish();
            return {
                ...firstPublication,
                ...(await verifyProduct(
                    firstPublication,
                    127,
                    'first',
                    173,
                    'updated',
                )),
            };
        });
        await capture('UPDATE', async () => {
            await setProduct(173, 'updated');
            latestPublication = await publish();
            expect(latestPublication.releaseId).not.toBe(
                firstPublication.releaseId,
            );
            expect(latestPublication.activeRevision).toBeGreaterThan(
                firstPublication.activeRevision,
            );
            return {
                ...latestPublication,
                ...(await verifyProduct(
                    latestPublication,
                    173,
                    'updated',
                    127,
                    'first',
                )),
            };
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
            verifyRollbackRevision(
                observed.activeRevision,
                latestPublication.activeRevision,
            );
            const responsePublic = await fetch(firstPublication.siteUrl),
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
                ...(await verifyProduct(
                    firstPublication,
                    127,
                    'first',
                    173,
                    'updated',
                )),
            };
        });
    }
}
