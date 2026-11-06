// Disposable current-source CMS + actual Preview source, for early local browser work.
// This is intentionally not a PlatformLock, release deployment or published site.
import { execFileSync } from 'node:child_process';
import { BrowserProcesses } from './browser-processes.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, chmod, open, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const { MongoClient } = requireBackend('mongodb');
const runRoot = path.join(root, '.e2e/runtime');
const previewRoot = path.resolve(
    process.env.E2E_PREVIEW_ROOT ||
        path.join(root, '../Independent-Website-Preview'),
);
const reference = process.env.E2E_DATABASE_ENV_FILE;
const command = process.argv[2];
if (!['serve', 'run'].includes(command) || !reference) {
    throw new Error(
        'Usage: E2E_DATABASE_ENV_FILE=<owned runtime.env> E2E_PREVIEW_ROOT=<Preview source> node ops/e2e/browser-runtime.mjs serve|run [-- command args]',
    );
}
process.umask(0o077);
await mkdir(runRoot, { recursive: true, mode: 0o700 });
await chmod(path.dirname(runRoot), 0o700);
const leasePath = path.join(runRoot, 'lease');
const lease = await open(leasePath, 'wx', 0o600);
const identity = randomBytes(8).toString('hex');
const database = `b3_browser_${identity}`;
const cms = 'http://127.0.0.1:18088';
const preview = 'http://127.0.0.1:18089';
const processes = new BrowserProcesses();
const logs = [];
let mongo;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => processes.interrupt());
function sourceIdentity(directory) {
    const git = (args) => execFileSync('git', args, { cwd: directory });
    const diff = git(['diff', 'HEAD', '--']);
    return {
        commit: git(['rev-parse', 'HEAD']).toString().trim(),
        sourceMode: 'current-working-tree',
        trackedChanges: diff.length !== 0,
        trackedDiffSha256: createHash('sha256').update(diff).digest('hex'),
    };
}
async function available(port) {
    await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () =>
            reject(
                new Error(
                    `Local fixture port ${port} is already in use; no process was stopped`,
                ),
            ),
        );
        probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
}
async function start(name, executable, args, options) {
    const output = await open(
        path.join(runRoot, `${name}.private.log`),
        'w',
        0o600,
    );
    logs.push(output);
    const child = processes.spawn(executable, args, {
        ...options,
        stdio: ['ignore', output.fd, output.fd],
    });
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => reject(new Error(`${name} failed to start`)));
    });
    return child;
}
async function ready(url, child, method = 'GET') {
    for (let attempt = 0; attempt < 150; attempt++) {
        if (processes.interrupted || child.exitCode !== null)
            throw new Error('Private fixture service stopped before readiness');
        try {
            if (
                (await fetch(url, { method, signal: AbortSignal.timeout(500) }))
                    .ok
            )
                return;
        } catch {
            /* wait */
        }
        await delay(200);
    }
    throw new Error(
        'Private fixture service readiness timed out; inspect private local logs',
    );
}
try {
    await available(18088);
    await available(18089);
    processes.throwIfInterrupted();
    const owned = Object.fromEntries(
        (await readFile(reference, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => {
                const at = line.indexOf('=');
                return [line.slice(0, at), line.slice(at + 1)];
            }),
    );
    if (!owned.E2E_DB_PASSWORD)
        throw new Error('Owned database env file is missing E2E_DB_PASSWORD');
    const dbUrl = `mongodb://e2e:${encodeURIComponent(owned.E2E_DB_PASSWORD)}@127.0.0.1:27029/${database}?authSource=admin`;
    mongo = new MongoClient(dbUrl);
    try {
        await mongo.connect();
    } catch {
        throw new Error('Owned disposable Mongo service is unavailable');
    }
    processes.throwIfInterrupted();
    for (const directory of [
        'backend/public',
        'ui',
        'preview/bundles',
        'private',
        'results',
    ]) {
        await mkdir(path.join(runRoot, directory), {
            recursive: true,
            mode: 0o700,
        });
    }
    const build = await start(
        'ui-build',
        'npm',
        ['run', 'build-only', '--', '--outDir', path.join(runRoot, 'ui/dist')],
        {
            cwd: path.join(root, 'ui'),
            env: {
                ...process.env,
                VITE_TEMPLATE_PREVIEW_ORIGIN: '',
                VITE_TEMPLATE_PREVIEW_RENDERERS: '',
                VITE_STOREFRONT_ORIGIN: '',
            },
        },
    );
    const buildCode = await processes.exit(build);
    if (buildCode !== 0)
        throw new Error(
            'Current-source UI build failed; inspect private build log',
        );
    await writeFile(
        path.join(runRoot, 'preview/index.json'),
        JSON.stringify({ schemaVersion: 1, records: [] }),
        { mode: 0o600 },
    );
    const previewChild = await start(
        'preview',
        process.execPath,
        [path.join(previewRoot, 'src/server.mjs')],
        {
            cwd: runRoot,
            env: {
                ...process.env,
                PREVIEW_HOST: '127.0.0.1',
                PREVIEW_PORT: '18089',
                PREVIEW_PUBLIC_ORIGIN: preview,
                PREVIEW_ADMIN_ORIGIN: cms,
                PREVIEW_REGISTRY_PATH: path.join(runRoot, 'preview/index.json'),
                PREVIEW_BUNDLES_ROOT: path.join(runRoot, 'preview/bundles'),
            },
        },
    );
    await ready(`${preview}/health-check`, previewChild);
    const cmsEnv = { ...process.env };
    for (const key of Object.keys(cmsEnv))
        if (key.startsWith('GATEWAY_') || key === 'CMS_SERVICE_SECRET')
            delete cmsEnv[key];
    const backend = await start(
        'cms',
        process.execPath,
        [
            '-r',
            requireBackend.resolve('ts-node/register'),
            '-r',
            requireBackend.resolve('tsconfig-paths/register'),
            path.join(root, 'backend/src/main.ts'),
        ],
        {
            cwd: path.join(runRoot, 'backend'),
            env: {
                ...cmsEnv,
                TS_NODE_PROJECT: path.join(root, 'backend/tsconfig.json'),
                TS_NODE_TRANSPILE_ONLY: 'true',
                SERVER_PORT: '18088',
                DB_URL: dbUrl,
                JWT_SECRET: randomBytes(32).toString('hex'),
                JWT_SCOPE: '127.0.0.1:18088',
                JWT_EXP_IN: '3600000',
                STOREFRONT_ENABLED: 'true',
                STOREFRONT_PREVIEW_SERVICE_URL: preview,
                STOREFRONT_MEDIA_ORIGIN: cms,
                // Explicitly prevent inherited production/control integrations in this local fixture.
                GATEWAY_BASE_URL: '',
                GATEWAY_SITE_BINDINGS: '[]',
                CMS_SERVICE_SECRET: '',
                STOREFRONT_GATEWAY_SECRET: '',
                STOREFRONT_DOMAIN_SECRET: '',
                PLUGINS: '',
            },
        },
    );
    await ready(`${cms}/api/v4/health-check`, backend, 'HEAD');
    let serverToken;
    for (let attempt = 0; attempt < 50 && !serverToken; attempt++) {
        serverToken = (
            await readFile(path.join(runRoot, 'cms.private.log'), 'utf8')
        ).match(/Server token: ([a-f0-9]+)/)?.[1];
        if (!serverToken) await delay(100);
    }
    if (!serverToken) throw new Error('Disposable CMS signup readiness failed');
    const email = `browser-${identity}@acceptance.invalid`;
    const password = randomBytes(24).toString('hex');
    async function api(route, body, token, selection = {}) {
        processes.throwIfInterrupted();
        const response = await fetch(`${cms}/api/v4${route}`, {
            method: body ? 'POST' : 'GET',
            signal: processes.signal,
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...selection,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok)
            throw new Error(
                `Disposable setup request failed (${response.status})`,
            );
        return response.json();
    }
    const auth = await api('/auth/signup-admin', {
        serverToken,
        email,
        password,
        firstName: 'Browser',
        lastName: 'Fixture',
    });
    const workspace = await api(
        '/workspaces',
        { name: `B3 browser ${identity}` },
        auth.accessToken,
    );
    const selector = { 'x-bcms-workspace': workspace._id };
    const site = await api(
        '/workspaces/current/sites',
        { name: 'Local renderer unavailable baseline' },
        auth.accessToken,
        selector,
    );
    selector['x-bcms-site'] = site._id;
    await api(
        '/presets/import',
        { presetId: 'aeroframe', siteName: site.name, includeDemo: true },
        auth.accessToken,
        selector,
    );
    const actual = (
        await api('/presets/site', undefined, auth.accessToken, selector)
    ).site;
    const testEnv = {
        ...process.env,
        STOREFRONT_E2E_CMS: cms,
        STOREFRONT_E2E_EMAIL: email,
        STOREFRONT_E2E_PASSWORD: password,
        STOREFRONT_E2E_WORKSPACE_ID: workspace._id,
        STOREFRONT_E2E_SITE_ID: site._id,
        STOREFRONT_E2E_PRIVATE_DIR: path.join(runRoot, 'private'),
        STOREFRONT_E2E_RESULTS_DIR: path.join(runRoot, 'results'),
    };
    await writeFile(
        path.join(runRoot, 'runtime.env'),
        Object.entries(testEnv)
            .filter(([key]) => key.startsWith('STOREFRONT_E2E_'))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n',
        { mode: 0o600 },
    );
    await writeFile(
        path.join(runRoot, 'source-baseline.json'),
        JSON.stringify(
            {
                evidenceType: 'local-browser-foundation-not-acceptance',
                cms: sourceIdentity(root),
                preview: sourceIdentity(previewRoot),
                database,
                templateId: actual.presetId,
                templateVersion: actual.presetVersion,
                rendererRegistry: 'empty',
                overallB3Complete: false,
            },
            null,
            2,
        ) + '\n',
    );
    processes.throwIfInterrupted();
    console.log(
        `Current-source CMS ready at ${cms}; actual ${actual.presetId}@${actual.presetVersion}; private injection in .e2e/runtime/runtime.env`,
    );
    if (command === 'run') {
        const separator = process.argv.indexOf('--');
        const args =
            separator === -1
                ? [
                      'npx',
                      'playwright',
                      'test',
                      '--config',
                      'ops/e2e/playwright.config.mjs',
                      'ops/e2e/preview.spec.mjs',
                  ]
                : process.argv.slice(separator + 1);
        if (!args.length) throw new Error('Missing runtime command');
        const child = processes.spawn(args[0], args.slice(1), {
            cwd: root,
            env: testEnv,
            stdio: 'inherit',
        });
        process.exitCode = await processes.exit(child);
    } else {
        await processes.stopped;
    }
} catch (error) {
    if (!processes.interrupted) throw error;
    process.exitCode = 0;
} finally {
    const cleanupErrors = [];
    // Do not delete credentials/builds or release the lease until owned groups exit.
    try {
        await processes.stop();
    } catch (error) {
        // Fail closed while allowing the helper itself to exit with its error.
        if (mongo) await mongo.close();
        for (const log of logs) await log.close();
        throw error;
    }
    for (const log of logs) await log.close();
    if (mongo) {
        try {
            await mongo.db(database).dropDatabase();
        } catch {
            cleanupErrors.push(`database ${database} was not removed`);
        } finally {
            await mongo.close();
        }
    }
    for (const directory of ['backend', 'ui', 'preview', 'private'])
        await rm(path.join(runRoot, directory), {
            recursive: true,
            force: true,
        });
    await rm(path.join(runRoot, 'runtime.env'), { force: true });
    for (const name of ['cms', 'preview', 'ui-build'])
        await rm(path.join(runRoot, `${name}.private.log`), { force: true });
    await lease.close();
    await rm(leasePath, { force: true });
    if (cleanupErrors.length)
        throw new Error(
            `Owned fixture cleanup incomplete: ${cleanupErrors.join('; ')}`,
        );
    console.log(
        'Owned browser processes, private build/auth output and disposable database removed; source baseline and product evidence retained',
    );
}
