import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { open, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cmsRoot, gatewayRoot, runtimeDir, readEnv } from './runtime.mjs';
const e = await readEnv();
const templatesRoot = path.resolve(
    process.env.E2E_TEMPLATES_ROOT ||
        path.join(cmsRoot, '../Independent-Website-Templates'),
);
const env = {
    ...process.env,
    E2E_RUNTIME_DIR: runtimeDir,
    E2E_GATEWAY_ROOT: gatewayRoot,
    STOREFRONT_ENABLED: 'true',
    STOREFRONT_TEST_MONGO: `mongodb://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:27029/admin?authSource=admin`,
    STOREFRONT_GATEWAY_SECRET: e.E2E_STOREFRONT_SECRET,
    STOREFRONT_DOMAIN_SECRET: e.E2E_DOMAIN_SECRET,
    DATABASE_URL: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
    GATEWAY_TEST_DATABASE_URL: `postgresql://e2e:${e.E2E_DB_PASSWORD}@127.0.0.1:15432/gateway_e2e`,
    STOREFRONT_E2E_CMS: 'http://127.0.0.1:18080',
    STOREFRONT_E2E_ORIGIN: 'http://127.0.0.1:13001',
    STOREFRONT_E2E_EMAIL: e.E2E_EMAIL,
    STOREFRONT_E2E_PASSWORD: e.E2E_PASSWORD,
    STOREFRONT_E2E_PREVIEW_ORIGINS:
        'http://127.0.0.1:13001,http://127.0.0.1:18081',
    E2E_CMS_IMAGE: 'local/cms-e2e:20261028',
    RELEASE_IMAGE: 'local/aeroframe:1.0.3',
    TEMPLATE_VERSION: '1.0.3',
    RELEASE_VERSION: '1.0.3',
    TEST_BUILT_TEMPLATE: '1',
};
const list = (root, pattern) =>
    execFileSync('rg', ['--files', '-g', pattern], {
        cwd: root,
        encoding: 'utf8',
    })
        .trim()
        .split('\n');
const suites = {
    backend: {
        cwd: path.join(cmsRoot, 'backend'),
        cmd: [
            'node',
            '--test',
            '--test-force-exit',
            '-r',
            'ts-node/register',
            '-r',
            'tsconfig-paths/register',
            ...list(path.join(cmsRoot, 'backend/src'), '*.test.ts').map(
                (f) => 'src/' + f,
            ),
        ],
    },
    ui: {
        cwd: cmsRoot,
        cmd: [
            'node',
            '--test',
            ...list(path.join(cmsRoot, 'ui/test'), '*.test.mjs').map(
                (f) => 'ui/test/' + f,
            ),
        ],
    },
    gateway: { cwd: gatewayRoot, cmd: ['npm', 'test'] },
    templates: { cwd: templatesRoot, cmd: ['npm', 'test'] },
    image: {
        cwd: cmsRoot,
        cmd: ['node', '--test', 'ops/e2e/ui-image-config.test.mjs'],
    },
    builtin: {
        cwd: cmsRoot,
        cmd: ['node', '--test', 'backend/test/storefront-deployment.test.mjs'],
    },
    'gateway-e2e': {
        cwd: cmsRoot,
        cmd: ['node', '--test', 'ops/e2e/gateway-flow.test.mjs'],
    },
    retirement: { cwd: cmsRoot, cmd: ['node', '--test', 'ops/e2e/gateway-retirement.test.mjs'] },
    recovery: {
        cwd: cmsRoot,
        cmd: ['node', '--test', 'ops/e2e/gateway-recovery.test.mjs'],
    },
};
const selected = process.argv[2];
const names = selected === 'all' ? Object.keys(suites) : [selected];
await mkdir(runtimeDir, { recursive: true });
for (const name of names) {
    const suite = suites[name];
    if (!suite) throw new Error(`Choose ${Object.keys(suites).join('|')}|all`);
    const logPath = path.join(runtimeDir, `${name}-rerun.log`),
        log = await open(logPath, 'w');
    console.log(`Running ${name}; log: ${logPath}`);
    let database;
    let admin;
    let run;
    try {
        const suiteEnv = { ...env };
        if (name === 'gateway') {
            // Worker claims are global. Never let unit/integration fixtures share
            // the running acceptance site's queue, credentials or routing state.
            const { Pool } = createRequire(path.join(gatewayRoot, 'package.json'))('pg');
            admin = new Pool({ connectionString: env.DATABASE_URL });
            const candidate = `gateway_test_${randomUUID().replaceAll('-', '')}`;
            await admin.query(`CREATE DATABASE "${candidate}"`);
            database = candidate;
            const url = new URL(env.DATABASE_URL);
            url.pathname = `/${database}`;
            suiteEnv.DATABASE_URL = url.href;
            suiteEnv.GATEWAY_TEST_DATABASE_URL = url.href;
            const migration = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
                cwd: gatewayRoot, env: suiteEnv, stdio: ['ignore', log.fd, log.fd],
            });
            if (migration.status !== 0) throw new Error('Gateway test database migration failed; see ignored log');
            console.log(`Isolated test database: ${database}`);
        }
        run = spawnSync(suite.cmd[0], suite.cmd.slice(1), {
            cwd: suite.cwd,
            env: suiteEnv,
            stdio: ['ignore', log.fd, log.fd],
        });
    } finally {
        try {
            // Only the fresh random database created by this invocation is removed.
            if (database) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        } finally {
            if (admin) await admin.end();
            await log.close();
        }
    }
    if (run.status !== 0)
        throw new Error(`${name} failed (${run.status}); see ignored log`);
    console.log(`${name}: PASS`);
}
