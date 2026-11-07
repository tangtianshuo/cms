import { defineConfig } from '@playwright/test';
import path from 'node:path';

// The pinned runner otherwise writes a raw DOM error-context snapshot, including account email.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
process.umask(0o077);
if (process.env.FORCE_COLOR) delete process.env.NO_COLOR;

export default defineConfig({
    testDir: '.',
    // launch.spec checks both viewport sizes on the same freshly created site.
    testMatch: /\/ops\/e2e\/[^/]+\.spec\.mjs$/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30000,
    expect: { timeout: 10000 },
    outputDir: path.resolve(
        process.env.STOREFRONT_E2E_RESULTS_DIR || '.e2e/results',
    ),
    reporter: [['line'], ['./preview-reporter.mjs']],
    use: {
        browserName: 'chromium',
        launchOptions: {
            args: process.env.STOREFRONT_E2E_MEDIA_SPKI
                ? [
                      '--ignore-certificate-errors-spki-list=' +
                          process.env.STOREFRONT_E2E_MEDIA_SPKI,
                  ]
                : [],
        },
        baseURL: process.env.STOREFRONT_E2E_CMS,
        locale: 'zh-CN',
        viewport: { width: 1440, height: 900 },
        // Controller ruling: session credentials must not enter retained evidence.
        // A sanitized screenshot is attached by browser-fixture after product failures.
        trace: 'off',
        screenshot: 'off',
        video: 'off',
    },
    projects: [
        { name: 'desktop' },
        {
            name: 'mobile',
            use: {
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true,
            },
        },
    ],
});
