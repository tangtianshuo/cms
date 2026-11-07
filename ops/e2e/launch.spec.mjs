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
import { workspace, openContent, openHero, save } from './launch-workspace.mjs';
import { runEditorScenarios } from './launch-editor.mjs';
import { runPreviewScenarios } from './launch-preview.mjs';
import { runPublicationScenarios } from './launch-publish.mjs';
for (const target of acceptanceTemplates)
    test(`launch ${target.id}`, async ({ page, traceSteps }, info) => {
        test.skip(!enabled, 'Dedicated launch runner required');
        test.setTimeout(420000);
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
            await runEditorScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                traceSteps,
            });
            await runPreviewScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                local,
                results,
                resultFile,
            });
            await runPublicationScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                runId,
                local,
            });
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
