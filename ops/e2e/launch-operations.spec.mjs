import { test, expect } from './browser-fixture.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('actual scoped lead assignment, status, CSV bytes and analytics deduplication', async ({
    page,
}, info) => {
    test.skip(
        !process.env.STOREFRONT_E2E_OPERATIONS,
        'Owned launch intake required',
    );
    test.setTimeout(60000);
    const source = JSON.parse(
        await readFile(process.env.STOREFRONT_E2E_OPERATIONS, 'utf8'),
    );
    for (const reverse of [false, true]) {
        const input = reverse
            ? {
                  ...source,
                  first: source.second,
                  second: source.first,
                  marker: source.otherMarker,
                  otherMarker: source.marker,
                  eventPath: source.otherEventPath,
              }
            : source;
        await page.goto('/d/studio');
        const select = async (site) => {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                page.evaluate(
                    async (site) =>
                        window.bcms.sdk.selectContext(
                            {
                                workspaceId: site.cmsWorkspaceId,
                                siteId: site.cmsSiteId,
                            },
                            '/d/leads',
                        ),
                    site,
                ),
            ]);
            await page.waitForFunction(
                (site) =>
                    window.bcms?.sdk?.context?.context?.siteId ===
                    site.cmsSiteId,
                site,
            );
            await expect(
                page.getByLabel('搜索询盘', { exact: true }),
            ).toBeVisible();
        };
        await select(input.first);
        await page.getByLabel('搜索询盘', { exact: true }).fill(input.marker);
        await page.getByLabel('搜索询盘', { exact: true }).press('Enter');
        await expect(
            page.getByRole('row').filter({ hasText: input.marker }),
        ).toHaveCount(1);
        await page
            .getByLabel(input.marker + ' 负责人', { exact: true })
            .fill('d1-local-operator');
        const update = page.waitForResponse(
            (r) =>
                r.request().method() === 'POST' &&
                new URL(r.url()).pathname.startsWith('/api/v4/leads/'),
        );
        await page
            .getByRole('button', { name: '保存负责人', exact: true })
            .click();
        expect((await update).status()).toBe(200);
        await expect(
            page.getByLabel(input.marker + ' 负责人', { exact: true }),
        ).toHaveValue('d1-local-operator');
        await page
            .getByLabel(input.marker + ' 状态', { exact: true })
            .selectOption('contacted');
        await expect
            .poll(async () =>
                page.evaluate(
                    async (marker) =>
                        (
                            await window.bcms.sdk.send({
                                url:
                                    '/api/v4/leads/?search=' +
                                    encodeURIComponent(marker),
                            })
                        ).items[0]?.status,
                    input.marker,
                ),
            )
            .toBe('contacted');
        const downloadPromise = page.waitForEvent('download');
        await page
            .getByRole('button', { name: '导出 CSV', exact: true })
            .click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        let csv = '';
        for await (const chunk of stream) csv += chunk;
        expect(csv).toContain(input.marker);
        expect(csv).toContain('contacted');
        expect(csv).not.toContain(input.otherMarker);
        expect(download.suggestedFilename()).toBe('leads.csv');
        const record = await page.evaluate(
            async (marker) =>
                (
                    await window.bcms.sdk.send({
                        url:
                            '/api/v4/leads/?search=' +
                            encodeURIComponent(marker),
                    })
                ).items[0],
            input.marker,
        );
        expect(record.assignedTo).toBe('d1-local-operator');
        const content = await page.evaluate(async () => {
            const sdk = window.bcms.sdk,
                s = await sdk.studio.getSite(),
                m = s.models.find((m) => m.key === 'home');
            return { templateId: m.templateId, entryId: m.entries[0].id };
        });
        await select(input.second);
        expect(input.first.mediaId).toBeTruthy();
        {
            const isolation = await page.evaluate(
                async ({ content, mediaId }) => {
                    const sdk = window.bcms.sdk;
                    const status = async (fn) => {
                        try {
                            await fn();
                            return 200;
                        } catch (error) {
                            return error.status;
                        }
                    };
                    return {
                        content: await status(() =>
                            sdk.entry.get({ ...content, skipCache: true }),
                        ),
                        media: await status(() =>
                            sdk.media.update({
                                _id: mediaId,
                                altText: 'foreign denied',
                            }),
                        ),
                    };
                },
                { content, mediaId: input.first.mediaId },
            );
            expect([403, 404]).toContain(isolation.content);
            expect([403, 404]).toContain(isolation.media);
        }
        const denial = await page.evaluate(async (id) => {
            try {
                await window.bcms.sdk.send({
                    url: '/api/v4/leads/' + id,
                    method: 'POST',
                    data: { status: 'closed' },
                });
                return 200;
            } catch (error) {
                return error.status;
            }
        }, record._id);
        expect(denial).toBe(404);
        const missing = await page.evaluate(async () => {
            try {
                await window.bcms.sdk.send({
                    url: '/api/v4/leads/00000000-0000-4000-8000-000000000000',
                    method: 'POST',
                    data: { status: 'closed' },
                });
                return 200;
            } catch (error) {
                return error.status;
            }
        });
        expect(missing).toBe(404);
        await select(input.first);
        await page.goto('/d/analytics');
        await expect(
            page.getByRole('row').filter({ hasText: input.eventPath }),
        ).toContainText('1');
        const summary = await page.evaluate(async () =>
            window.bcms.sdk.send({ url: '/api/v4/analytics/?days=7' }),
        );
        expect(summary.status).toBe('ready');
        expect(
            summary.pages.find((p) => p.path === input.eventPath).views,
        ).toBe(1);
        await page.route('**/api/v4/analytics/?*', (route) =>
            route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{"message":"unavailable"}',
            }),
        );
        await page.reload();
        await expect(page.getByRole('alert')).toContainText(
            '访问数据暂时不可用',
        );
        await expect(page.locator('.studio-metric')).toHaveCount(0);
        await page.unroute('**/api/v4/analytics/?*');
        await page
            .getByRole('button', { name: '重新加载', exact: true })
            .click();
        await expect(page.locator('.studio-metric')).toHaveCount(2);
        const evidence = {
            scope: source.scope || 'actual-local-CMS-Gateway-intake-browser',
            runId: source.runId,
            lockChecksum: source.lockChecksum,
            target: input.first.target,
            cases: ['LEADS', 'ANALYTICS', 'ISOLATION'].map((name) => ({
                id: input.first.target?.id + '/' + name,
                status: 'passed',
                reason: 'Current owned runtime intake, authenticated UI and both-direction isolation',
                artifacts: ['operations-proof.json'],
            })),
            assignmentPersisted: true,
            statusPersisted: true,
            downloadContainsSelectedLead: true,
            csvChecksum:
                'sha256:' + createHash('sha256').update(csv).digest('hex'),
            crossSiteMutationDenied: true,
            eventDeduplicated: true,
            errorNotZero: true,
        };
        const file = source.resultDirectory
            ? source.resultDirectory + '/' + input.first.target.id + '.json'
            : info.outputPath(
                  'operations-proof-' +
                      (reverse ? 'second' : 'first') +
                      '.json',
              );
        await writeFile(file, JSON.stringify(evidence, null, 2), {
            mode: 0o600,
        });
        await info.attach('operations-proof', {
            path: file,
            contentType: 'application/json',
        });
    }
});
