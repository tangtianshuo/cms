import { test as base, expect } from '@playwright/test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finishBrowserEvidence } from './browser-evidence.mjs';
import { interactionTrace } from './interaction-trace.mjs';
import { installPublicationReadGuard } from './publication-observation.mjs';
const timelines = new WeakMap();

export function browserEnvironment(env = process.env) {
    let cms;
    try {
        cms = new URL(env.STOREFRONT_E2E_CMS);
    } catch {
        /* sanitized below */
    }
    if (
        !cms ||
        !['http:', 'https:'].includes(cms.protocol) ||
        cms.origin !== env.STOREFRONT_E2E_CMS ||
        cms.username ||
        cms.password
    ) {
        throw new Error(
            'STOREFRONT_E2E_CMS must be a canonical HTTP(S) origin',
        );
    }
    if (!env.STOREFRONT_E2E_EMAIL || !env.STOREFRONT_E2E_PASSWORD) {
        throw new Error(
            'Inject STOREFRONT_E2E_EMAIL and STOREFRONT_E2E_PASSWORD privately',
        );
    }
    if (
        Boolean(env.STOREFRONT_E2E_WORKSPACE_ID) !==
        Boolean(env.STOREFRONT_E2E_SITE_ID)
    ) {
        throw new Error(
            'Inject both STOREFRONT_E2E_WORKSPACE_ID and STOREFRONT_E2E_SITE_ID',
        );
    }
    return {
        cms: cms.origin,
        email: env.STOREFRONT_E2E_EMAIL,
        password: env.STOREFRONT_E2E_PASSWORD,
    };
}

// Call only on an untraced, unrecorded private context. Never attach this page.
export async function login(page, env = process.env) {
    const { cms, email, password } = browserEnvironment(env);
    try {
        await page.goto(`${cms}/`);
        await page.getByRole('textbox', { name: /^(邮箱|Email)$/ }).fill(email);
        await page
            .getByLabel(/^(密码|Password)$/, { exact: true })
            .fill(password);
        await page.getByRole('button', { name: /^(登录|Log in)$/ }).click();
        await page.waitForURL(
            (url) => url.origin === cms && url.pathname.startsWith('/d'),
            { timeout: 15000 },
        );
        await page
            .getByRole('heading', { name: '工作台', exact: true })
            .waitFor({ timeout: 10000 });
    } catch {
        // Playwright locator errors can contain fill values and request URLs.
        throw new Error(
            'Private CMS login failed; credentials and login artifacts withheld',
        );
    }
}

const privateRoot = path.resolve(
    process.env.STOREFRONT_E2E_PRIVATE_DIR || '.e2e/private',
);
export const test = base.extend({
    authState: [
        async ({ browser }, use, workerInfo) => {
            await mkdir(privateRoot, { recursive: true, mode: 0o700 });
            await chmod(privateRoot, 0o700);
            const statePath = path.join(
                privateRoot,
                `auth-${process.pid}-${workerInfo.workerIndex}.json`,
            );
            // browser.newContext deliberately bypasses Playwright test context recording.
            const context = await browser.newContext({ locale: 'zh-CN' });
            const assertSafe = process.env.STOREFRONT_E2E_FORMAL_PREVIEW
                ? await installPublicationReadGuard(context)
                : () => {};
            try {
                await login(await context.newPage());
                if (
                    process.env.STOREFRONT_E2E_WORKSPACE_ID &&
                    process.env.STOREFRONT_E2E_SITE_ID
                ) {
                    const page = context.pages()[0];
                    await page.evaluate(
                        async (selection) => {
                            await window.bcms.sdk.selectContext(
                                selection,
                                '/d/studio',
                            );
                        },
                        {
                            workspaceId:
                                process.env.STOREFRONT_E2E_WORKSPACE_ID,
                            siteId: process.env.STOREFRONT_E2E_SITE_ID,
                        },
                    );
                    await page.waitForURL('**/d/studio');
                }
                assertSafe();
                // Create privately before writing so even a permissive umask cannot expose tokens.
                await writeFile(
                    statePath,
                    JSON.stringify(await context.storageState()),
                    { mode: 0o600, flag: 'wx' },
                );
                await context.close();
                await use(statePath);
            } finally {
                await context.close().catch(() => {});
                await rm(statePath, { force: true });
                assertSafe();
            }
        },
        { scope: 'worker' },
    ],
    storageState: async ({ authState }, use) => use(authState),
    installation: async ({ page }, use) => {
        await page.goto('/d/studio');
        await page
            .getByRole('heading', { name: '工作台', exact: true })
            .waitFor();
        const installation = await page.evaluate(async () => {
            const result = await window.bcms.sdk.send({
                url: '/api/v4/presets/site',
            });
            const site = result.site;
            return (
                site && {
                    templateId: site.presetId,
                    templateVersion: site.presetVersion,
                }
            );
        });
        if (!installation?.templateId || !installation.templateVersion)
            throw new Error('Select a ready isolated test site');
        await use(installation);
    },
    siteUrl: async ({}, use) => {
        const siteUrl = process.env.STOREFRONT_E2E_SITE_URL;
        if (!siteUrl)
            throw new Error(
                'Inject the actual published STOREFRONT_E2E_SITE_URL before public roundtrip assertions',
            );
        const url = new URL(siteUrl);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password
        )
            throw new Error('Invalid published site URL');
        await use(url.href);
    },
    traceSteps: async ({ page }, use) => use(timelines.get(page)),
    page: async ({ page }, use, testInfo) => {
        const assertSafe =
            process.env.STOREFRONT_E2E_FORMAL_PREVIEW ||
            testInfo.title.includes('[PUBLISH]')
                ? await installPublicationReadGuard(page.context())
                : () => {};
        const timeline = interactionTrace(page);
        timelines.set(page, timeline);
        await use(page);
        await finishBrowserEvidence({ assertSafe, timeline, failed: testInfo.status !== testInfo.expectedStatus, retain: async (trace) => {
            if (page.isClosed()) return;
            const tracePath = testInfo.outputPath(
                'failure-interaction-timeline.json',
            );
            await writeFile(tracePath, JSON.stringify(trace, null, 2), {
                mode: 0o600,
            });
            await testInfo.attach('failure-interaction-timeline', {
                path: tracePath,
                contentType: 'application/json',
            });
            // Native trace/HAR/video each retain credentials; this timeline is not a replay trace.
            const screenshot = testInfo.outputPath('failure-sanitized.png');
            await page.screenshot({
                path: screenshot,
                fullPage: true,
                mask: [
                    page.locator(
                        'input[type="password"], input[type="email"], [data-e2e-private]',
                    ),
                    page.getByText(process.env.STOREFRONT_E2E_EMAIL, {
                        exact: false,
                    }),
                ],
            });
            await chmod(screenshot, 0o600);
            await testInfo.attach('failure-sanitized', {
                path: screenshot,
                contentType: 'image/png',
            });
            await testInfo.attach('diagnostic', {
                body: 'Authenticated product interaction failed. Private login and native network recording are disabled. A fixed-schema interaction timeline is attached.',
                contentType: 'text/plain',
            });
        }});
    },
});
export { expect };
