import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserEnvironment } from './browser-fixture.mjs';

test('rejects credential-bearing and noncanonical CMS URLs without echoing them', () => {
    for (const cms of [
        'https://private:secret@example.test',
        'https://example.test/?secret=1',
        'file:///private',
        'https://example.test/',
    ]) {
        assert.throws(
            () => browserEnvironment({ STOREFRONT_E2E_CMS: cms }),
            (error) =>
                error.message ===
                'STOREFRONT_E2E_CMS must be a canonical HTTP(S) origin',
        );
    }
});
test('requires private injected credentials before starting a browser login', () => {
    assert.throws(
        () =>
            browserEnvironment({
                STOREFRONT_E2E_CMS: 'http://127.0.0.1:18088',
            }),
        /Inject STOREFRONT_E2E_EMAIL/,
    );
});

// Run these real Chromium checks through browser-runtime.mjs run; they do not
// turn an absent local CMS into a passing browser/security result.
const hasRuntime = Boolean(
    process.env.STOREFRONT_E2E_CMS && process.env.STOREFRONT_E2E_PASSWORD,
);
test(
    'failed real login retains no login screenshots, recordings or credential-bearing output',
    { skip: !hasRuntime, timeout: 45000 },
    async () => {
        const { spawnSync } = await import('node:child_process');
        const { mkdir, readdir, readFile, rm } = await import(
            'node:fs/promises'
        );
        const path = await import('node:path');
        const outputDir = path.resolve('.e2e/security/failed-login');
        await rm(outputDir, { recursive: true, force: true });
        await mkdir(outputDir, { recursive: true, mode: 0o700 });
        const badPassword = 'private-login-failure-probe';
        const result = spawnSync(
            process.execPath,
            [
                'node_modules/@playwright/test/cli.js',
                'test',
                '--config',
                'ops/e2e/playwright.config.mjs',
                'ops/e2e/preview.spec.mjs',
                '--project=desktop',
                '--grep',
                'real login',
            ],
            {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    STOREFRONT_E2E_PASSWORD: badPassword,
                    STOREFRONT_E2E_RESULTS_DIR: outputDir,
                },
                timeout: 40000,
            },
        );
        assert.equal(result.status, 1);
        const output = result.stdout + result.stderr;
        assert.equal(output.includes('Private CMS login failed'), true);
        for (const secret of [
            badPassword,
            process.env.STOREFRONT_E2E_EMAIL,
            process.env.STOREFRONT_E2E_PASSWORD,
        ])
            assert.equal(output.includes(secret), false);
        const files = await readdir(outputDir, { recursive: true });
        assert.equal(
            files.some((file) => /\.(png|zip|har|webm)$/.test(file)),
            false,
        );
        for (const file of files.filter((file) =>
            /\.(md|json|txt)$/.test(file),
        )) {
            const text = await readFile(path.join(outputDir, file), 'utf8');
            for (const secret of [
                badPassword,
                process.env.STOREFRONT_E2E_EMAIL,
                process.env.STOREFRONT_E2E_PASSWORD,
            ])
                assert.equal(text.includes(secret), false);
            assert.equal(
                /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(
                    text,
                ),
                false,
            );
        }
    },
);

test(
    'failed authenticated interaction retains a masked screenshot without raw DOM or network recordings',
    { skip: !hasRuntime, timeout: 45000 },
    async () => {
        const { spawnSync } = await import('node:child_process');
        const { mkdir, readdir, readFile, rm, writeFile } = await import(
            'node:fs/promises'
        );
        const path = await import('node:path');
        const outputDir = path.resolve('.e2e/security/failed-product');
        const probe = path.resolve('ops/e2e/browser-evidence-probe.spec.mjs');
        await rm(outputDir, { recursive: true, force: true });
        await mkdir(outputDir, { recursive: true, mode: 0o700 });
        await writeFile(
            probe,
            `import { test } from './browser-fixture.mjs';\ntest('safe product failure probe', async ({ page }) => { await page.goto('/d/studio'); await page.getByRole('heading', { name: '工作台', exact: true }).waitFor(); throw new Error('Controlled product failure probe'); });\n`,
            { mode: 0o600, flag: 'wx' },
        );
        try {
            const result = spawnSync(
                process.execPath,
                [
                    'node_modules/@playwright/test/cli.js',
                    'test',
                    '--config',
                    'ops/e2e/playwright.config.mjs',
                    probe,
                    '--project=desktop',
                ],
                {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        STOREFRONT_E2E_RESULTS_DIR: outputDir,
                    },
                    timeout: 40000,
                },
            );
            assert.equal(result.status, 1);
            for (const secret of [
                process.env.STOREFRONT_E2E_EMAIL,
                process.env.STOREFRONT_E2E_PASSWORD,
            ])
                assert.equal(
                    (result.stdout + result.stderr).includes(secret),
                    false,
                );
            const files = await readdir(outputDir, { recursive: true });
            assert.equal(
                files.some((file) => file.endsWith('failure-sanitized.png')),
                true,
            );
            assert.equal(
                files.some((file) => /\.(zip|har|webm)$/.test(file)),
                false,
            );
            for (const file of files.filter((file) =>
                /\.(md|json|txt)$/.test(file),
            )) {
                const text = await readFile(path.join(outputDir, file), 'utf8');
                assert.equal(text.includes('# Page snapshot'), false);
                for (const secret of [
                    process.env.STOREFRONT_E2E_EMAIL,
                    process.env.STOREFRONT_E2E_PASSWORD,
                ])
                    assert.equal(text.includes(secret), false);
                assert.equal(
                    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(
                        text,
                    ),
                    false,
                );
            }
        } finally {
            await rm(probe, { force: true });
        }
    },
);

test(
    'default acceptance entrypoint stays nonzero even after a green local foundation',
    { skip: !hasRuntime, timeout: 45000 },
    async () => {
        const { spawnSync } = await import('node:child_process');
        const { readdir, stat } = await import('node:fs/promises');
        const result = spawnSync(
            process.execPath,
            ['ops/e2e/preview-roundtrip.mjs'],
            {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    STOREFRONT_E2E_RESULTS_DIR: '.e2e/security/default-gate',
                },
                timeout: 40000,
            },
        );
        assert.equal(result.status, 1);
        assert.equal(result.stdout.includes('"foundationPassed":true'), true);
        assert.equal(result.stdout.includes('"overallB3Complete":false'), true);
        assert.equal(result.stdout.includes('AcceptanceEvidence'), false);
        assert.equal(
            (await readdir(process.env.STOREFRONT_E2E_PRIVATE_DIR)).some(
                (file) => file.startsWith('auth-'),
            ),
            false,
        );
        assert.equal(
            (await stat(process.env.STOREFRONT_E2E_PRIVATE_DIR)).mode & 0o777,
            0o700,
        );
    },
);

test('rejects a partial site selector instead of silently using another selection', () => {
    assert.throws(
        () =>
            browserEnvironment({
                STOREFRONT_E2E_CMS: 'http://127.0.0.1:18088',
                STOREFRONT_E2E_EMAIL: 'fixture@acceptance.invalid',
                STOREFRONT_E2E_PASSWORD: 'injected',
                STOREFRONT_E2E_SITE_ID: 'actual-site',
            }),
        /Inject both STOREFRONT_E2E_WORKSPACE_ID and STOREFRONT_E2E_SITE_ID/,
    );
});
