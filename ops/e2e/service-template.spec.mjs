import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { chromium } from 'playwright';

const cmsRoot = new URL('../../', import.meta.url).pathname;
const templatesRoot =
    process.env.E2E_TEMPLATES_ROOT ||
    '/Users/445101599qq.com/.codex/worktrees/platform-delivery-templates/Independent-Website-Templates';
const templateRoot = join(templatesRoot, 'templates/service-studio/1.0.0');
const storefrontRoot = join(templateRoot, 'storefront');
const bridge = join(templateRoot, 'contract-tests/cms-install.cjs');

function serviceRelease(stage) {
    return JSON.parse(
        execFileSync(
            process.execPath,
            ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', bridge],
            {
                cwd: cmsRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    TS_NODE_PROJECT: 'backend/tsconfig.json',
                    TS_NODE_TRANSPILE_ONLY: '1',
                    SERVICE_STUDIO_MANIFEST: join(
                        templateRoot,
                        'template.json',
                    ),
                    SERVICE_STUDIO_STAGE: stage,
                },
            },
        ),
    );
}

async function ensureBuild() {
    try {
        await stat(join(storefrontRoot, 'node_modules/.package-lock.json'));
    } catch {
        execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
            cwd: storefrontRoot,
            stdio: 'inherit',
        });
    }
    execFileSync('npm', ['run', 'build'], {
        cwd: storefrontRoot,
        stdio: 'inherit',
    });
}

async function freePort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function ready(origin) {
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            const response = await fetch(`${origin}/healthz`, {
                signal: AbortSignal.timeout(500),
            });
            if (response.ok) return;
        } catch {
            // Wait for the current build to bind.
        }
        await delay(100);
    }
    throw new Error('service-studio runtime did not become ready');
}

async function startStorefront(
    snapshotPath,
    previewOrigin,
    adminOrigin,
    identity,
) {
    const stdout = [];
    const stderr = [];
    const child = spawn(process.execPath, ['.output/server/index.mjs'], {
        cwd: storefrontRoot,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            HOST: '127.0.0.1',
            PORT: new URL(previewOrigin).port,
            PUBLISHED_SNAPSHOT_PATH: snapshotPath,
            NUXT_WORKSPACE_ID: identity.workspaceId,
            NUXT_SITE_ID: identity.siteId,
            NUXT_PUBLIC_PREVIEW_ADMIN_ORIGIN: adminOrigin,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    await ready(previewOrigin);
    return {
        child,
        stop: async () => {
            if (child.exitCode !== null) return;
            child.kill('SIGTERM');
            await new Promise((resolve) => child.once('exit', resolve));
        },
        output: () => Buffer.concat([...stdout, ...stderr]).toString('utf8'),
    };
}

test(
    'service-studio completes install, preview, publish, page, navigation, update and rollback',
    {
        timeout: 120_000,
    },
    async () => {
        await ensureBuild();
        const directory = await mkdtemp(join(tmpdir(), 'service-studio-e2e-'));
        const activePath = join(directory, 'active.json');
        const sequence = serviceRelease('updated');
        const initial = sequence.initial;
        const updated = sequence.updated;
        const identity = {
            workspaceId: sequence.workspaceId,
            siteId: sequence.siteId,
        };
        assert.deepEqual(sequence.models, [
            'service',
            'site-settings',
            'team-member',
        ]);
        assert.equal(sequence.models.includes('product'), false);
        assert.equal(initial.pages.length, 5);
        assert.ok(updated.pages.includes('/services/strategy'));
        assert.ok(updated.pages.includes('/services/content-systems'));
        assert.notEqual(initial.checksum, updated.checksum);
        assert.equal(sequence.history.siteId, sequence.siteId);
        assert.equal(sequence.history.releases.length, 2);
        assert.equal(sequence.history.currentReleaseId, initial.releaseId);
        assert.deepEqual(
            new Set(sequence.history.publishedReleaseIds),
            new Set([initial.releaseId, updated.releaseId]),
        );
        assert.deepEqual(sequence.history.audits, [
            'publish',
            'publish',
            'rollback',
        ]);
        assert.deepEqual(
            sequence.history.releases.map((release) => release.siteId),
            [sequence.siteId, sequence.siteId],
        );
        await writeFile(activePath, JSON.stringify(initial.snapshot));

        const previewPort = await freePort();
        const adminPort = await freePort();
        const previewOrigin = `http://127.0.0.1:${previewPort}`;
        const adminOrigin = `http://127.0.0.1:${adminPort}`;
        const parent = createServer(async (request, response) => {
            if (request.url === '/snapshot') {
                response.writeHead(200, {
                    'content-type': 'application/json',
                    'cache-control': 'no-store',
                });
                response.end(await readFile(activePath));
                return;
            }
            response.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
            });
            response.end(`<!doctype html>
          <h1>Private service preview</h1>
          <iframe id="preview" src="${previewOrigin}/preview"></iframe>
          <script>
            addEventListener('message', async event => {
              if (event.origin !== '${previewOrigin}' || event.data?.type !== 'storefront:preview-ready') return;
              const snapshot = await fetch('/snapshot').then(response => response.json());
              event.source.postMessage({
                type: 'storefront:preview',
                payload: snapshot,
                path: '/team'
              }, '${previewOrigin}');
            });
          </script>`);
        });
        await new Promise((resolve, reject) => {
            parent.once('error', reject);
            parent.listen(adminPort, '127.0.0.1', resolve);
        });

        let runtime = await startStorefront(
            activePath,
            previewOrigin,
            adminOrigin,
            identity,
        );
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage({
                viewport: { width: 1440, height: 960 },
            });
            let response = await page.goto(previewOrigin + '/');
            assert.equal(response?.status(), 200, runtime.output());
            await page
                .getByRole('heading', { level: 1, name: /Digital discovery/i })
                .waitFor();
            assert.match(
                await page.locator('body').innerText(),
                /Clearline Studio/,
            );
            assert.doesNotMatch(
                await page.locator('body').innerText(),
                /\b(product|template|release|docker)\b/i,
            );

            for (const path of [
                '/services',
                '/services/discovery',
                '/team',
                '/contact',
            ]) {
                response = await page.goto(previewOrigin + path);
                assert.equal(response?.status(), 200, path);
            }
            assert.match(
                await page.locator('body').innerText(),
                /hello@clearline\.example/,
            );

            await page.goto(adminOrigin + '/');
            const frame = page.frameLocator('#preview');
            await frame.getByText('Mina Park', { exact: false }).waitFor();
            assert.match(
                await frame.locator('body').innerText(),
                /Service design lead/,
            );

            await runtime.stop();
            await writeFile(activePath, JSON.stringify(updated.snapshot));
            runtime = await startStorefront(
                activePath,
                previewOrigin,
                adminOrigin,
                identity,
            );
            response = await page.goto(previewOrigin + '/services/strategy');
            assert.equal(response?.status(), 200);
            assert.match(
                await page.locator('body').innerText(),
                /Strategy sprint/,
            );
            assert.match(
                await page.locator('body').innerText(),
                /second published service update/i,
            );
            response = await page.goto(
                previewOrigin + '/services/content-systems',
            );
            assert.equal(response?.status(), 200);
            assert.match(
                await page.locator('body').innerText(),
                /Content systems/,
            );
            await page.goto(previewOrigin + '/services');
            assert.match(
                await page.locator('body').innerText(),
                /Strategy sprint/,
            );
            assert.match(
                await page.locator('body').innerText(),
                /Content systems/,
            );
            assert.equal(
                await page
                    .getByRole('navigation', { name: 'Main navigation' })
                    .locator('a[href="/services/content-systems"]')
                    .count(),
                1,
            );
            await page.goto(previewOrigin + '/team');
            assert.match(
                await page.locator('body').innerText(),
                /Mina Park, updated/,
            );
            assert.match(await page.locator('body').innerText(), /Arun Shah/);

            await runtime.stop();
            await writeFile(
                activePath,
                JSON.stringify(sequence.rolledBack.snapshot),
            );
            runtime = await startStorefront(
                activePath,
                previewOrigin,
                adminOrigin,
                identity,
            );
            response = await page.goto(previewOrigin + '/services/strategy');
            assert.equal(response?.status(), 404);
            await page.goto(previewOrigin + '/');
            assert.match(
                await page.locator('body').innerText(),
                /Digital discovery/,
            );
            assert.doesNotMatch(
                await page.locator('body').innerText(),
                /Strategy sprint/,
            );
        } finally {
            await runtime.stop();
            await browser.close();
            await new Promise((resolve) => parent.close(resolve));
            await rm(directory, { recursive: true, force: true });
        }
    },
);
