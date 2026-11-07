// Disposable current-source CMS + actual Preview source, for early local browser work.
// This is intentionally not a PlatformLock, release deployment or published site.
import { execFileSync } from 'node:child_process';
import {
    localSectionBundles,
    provisionSectionSite,
} from './section-fixture.mjs';
import { installPreviewFixtures } from './installed-preview-fixture.mjs';
import { savedContractFixture } from './saved-snapshot-fixture.mjs';
import { httpsMediaFixture } from './https-media-fixture.mjs';
import { BrowserProcesses } from './browser-processes.mjs';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
    mkdir,
    chmod,
    open,
    readFile,
    writeFile,
    rm,
    cp,
} from 'node:fs/promises';
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
let mediaFixture;
const artifactTemplatesRoot = process.env.E2E_B3_TEMPLATES_ROOT;
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => processes.interrupt());
function sourceIdentity(directory) {
    const git = (args) => execFileSync('git', args, { cwd: directory });
    const diff = git(['diff', 'HEAD', '--']);
    const files = git([
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
    ])
        .toString()
        .split('\0')
        .filter(Boolean)
        .sort()
        .map((relative) => ({
            path: relative,
            sha256: createHash('sha256')
                .update(readFileSync(path.join(directory, relative)))
                .digest('hex'),
        }));
    return {
        commit: git(['rev-parse', 'HEAD']).toString().trim(),
        sourceMode: 'current-working-tree',
        trackedChanges: diff.length !== 0,
        trackedDiffSha256: createHash('sha256').update(diff).digest('hex'),
        sourceFiles: files,
        sourceFilesSha256: createHash('sha256')
            .update(JSON.stringify(files))
            .digest('hex'),
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
    if (artifactTemplatesRoot) await available(18090);
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
    if (artifactTemplatesRoot) {
        mediaFixture = await httpsMediaFixture({
            privateRoot: path.join(runRoot, 'private'),
            cms,
        });
        await installPreviewFixtures({
            templatesRoot: path.resolve(artifactTemplatesRoot),
            previewRoot,
            runRoot,
            root,
            cms,
            build: async (id, cwd, env) => {
                const child = await start(
                    'preview-build-' + id,
                    'npm',
                    ['run', 'build:preview'],
                    { cwd, env },
                );
                if ((await processes.exit(child)) !== 0)
                    throw new Error('Local preview artifact build failed');
            },
        });
    }
    if (!artifactTemplatesRoot && process.env.E2E_SECTION_TEMPLATES_ROOT)
        await localSectionBundles({
            templatesRoot: path.resolve(process.env.E2E_SECTION_TEMPLATES_ROOT),
            runRoot,
            root,
        });
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
                STOREFRONT_MEDIA_ORIGIN: mediaFixture?.origin || cms,
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
        { name: 'Local renderer unavailable baseline', requestKey:'preview-'+identity },
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
    const sectionEnvironment =
        artifactTemplatesRoot || process.env.E2E_SECTION_TEMPLATES_ROOT
            ? await provisionSectionSite({
                  templatesRoot: path.resolve(
                      artifactTemplatesRoot ||
                          process.env.E2E_SECTION_TEMPLATES_ROOT,
                  ),
                  root,
                  runRoot,
                  db: mongo.db(database),
                  site,
                  workspace,
                  api,
                  token: auth.accessToken,
                  selector,
                  cms,
              })
            : {};
    const actual = (
        await api('/presets/site', undefined, auth.accessToken, selector)
    ).site;
    let localSnapshotPath;
    if (artifactTemplatesRoot) {
        await available(18091);
        const storefront = path.join(
            artifactTemplatesRoot,
            'templates',
            actual.presetId,
            actual.presetVersion,
            'storefront',
        );
        const child = await start('published-build', 'npm', ['run', 'build'], {
            cwd: storefront,
            env: {
                ...process.env,
                PREVIEW_APP_BASE_URL: '',
                NUXT_PUBLIC_PREVIEW_ADMIN_ORIGIN: '',
            },
        });
        if ((await processes.exit(child)) !== 0)
            throw new Error('Local saved-snapshot runtime build failed');
        await cp(
            path.join(storefront, '.output'),
            path.join(runRoot, 'published'),
            { recursive: true },
        );
        localSnapshotPath = path.join(runRoot, 'private/published.json');
        const snapshot = await api(
            '/storefront/site-preview',
            undefined,
            auth.accessToken,
            selector,
        );
        await writeFile(
            localSnapshotPath,
            JSON.stringify(await savedContractFixture(snapshot, { root, cms })),
            { mode: 0o600 },
        );
        const published = await start(
            'published',
            process.execPath,
            [path.join(runRoot, 'published/server/index.mjs')],
            {
                cwd: runRoot,
                env: {
                    ...process.env,
                    HOST: '127.0.0.1',
                    PORT: '18091',
                    NUXT_WORKSPACE_ID: workspace._id,
                    NUXT_SITE_ID: site._id,
                    PUBLISHED_SNAPSHOT_PATH: localSnapshotPath,
                    NUXT_PUBLISHED_SNAPSHOT_PATH: localSnapshotPath,
                },
            },
        );
        await ready('http://127.0.0.1:18091/healthz', published);
    }
    const d1FixturePath = path.join(runRoot, 'private/d1-site-fixture.json');
    if (artifactTemplatesRoot) await writeFile(d1FixturePath, JSON.stringify({ dbUrl, database, baselineSiteId: site._id }), { mode: 0o600 });
    const testEnv = {
        ...(artifactTemplatesRoot ? { STOREFRONT_E2E_D1_SITE_FIXTURE: d1FixturePath } : {}),
        ...process.env,
        ...sectionEnvironment,
        ...(localSnapshotPath
            ? {
                  STOREFRONT_E2E_LOCAL_SNAPSHOT_PATH: localSnapshotPath,
                  STOREFRONT_E2E_LOCAL_RUNTIME_URL: 'http://127.0.0.1:18091',
              }
            : {}),
        STOREFRONT_E2E_CMS: cms,
        ...(mediaFixture
            ? {
                  STOREFRONT_E2E_MEDIA_SPKI: mediaFixture.spki,
                  STOREFRONT_E2E_MEDIA_ORIGIN: mediaFixture.origin,
                  STOREFRONT_E2E_B3_INSTALLED: path.join(
                      runRoot,
                      'b3-installed-records.json',
                  ),
              }
            : {}),
        STOREFRONT_E2E_EMAIL: email,
        STOREFRONT_E2E_PASSWORD: password,
        STOREFRONT_E2E_WORKSPACE_ID: workspace._id,
        STOREFRONT_E2E_SITE_ID: site._id,
        STOREFRONT_E2E_PRIVATE_DIR: path.join(runRoot, 'private'),
        STOREFRONT_E2E_RESULTS_DIR:
            process.env.STOREFRONT_E2E_RESULTS_DIR ||
            path.join(runRoot, 'results'),
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
                rendererRegistry: artifactTemplatesRoot
                    ? 'production-B2-installer-local-OCI-artifacts'
                    : process.env.E2E_SECTION_TEMPLATES_ROOT
                      ? 'actual-local-bundles-not-public'
                      : 'empty',
                overallB3Complete: false,
            },
            null,
            2,
        ) + '\n',
    );
    if (process.env.STOREFRONT_E2E_RESULTS_DIR) {
        await mkdir(process.env.STOREFRONT_E2E_RESULTS_DIR, {
            recursive: true,
        });
        await cp(
            path.join(runRoot, 'source-baseline.json'),
            process.env.STOREFRONT_E2E_RESULTS_DIR + '-source-baseline.json',
        );
        if (artifactTemplatesRoot)
            await cp(
                path.join(runRoot, 'b3-installed-records.json'),
                process.env.STOREFRONT_E2E_RESULTS_DIR +
                    '-installed-records.json',
            );
    }
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
    if (mediaFixture) {
        await mediaFixture.close();
        await writeFile(
            path.join(runRoot, 'b3-https-media-proof.json'),
            JSON.stringify(
                {
                    scope: 'local-authorized-CMS-capability-bytes-not-public-TLS',
                    requests: mediaFixture.requests,
                },
                null,
                2,
            ),
        );
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
    for (const directory of [
        'backend',
        'ui',
        'preview',
        'preview-artifacts',
        'published',
        'private',
    ])
        await rm(path.join(runRoot, directory), {
            recursive: true,
            force: true,
        });
    await rm(path.join(runRoot, 'runtime.env'), { force: true });
    for (const name of [
        'cms',
        'preview',
        'ui-build',
        'preview-build-aeroframe',
        'preview-build-fireguard',
        'published-build',
        'published',
    ])
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
