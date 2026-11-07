// Disposable local DNS/CA and actual production CMS jobs/Gateway handlers/worker.
// This is not public wildcard DNS, ACME, public OCI, or production acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer as tlsServer, request as tlsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserProcesses } from './browser-processes.mjs';
export async function runOwnedFixture(options = {}) {
    assert.ok(
        !options.formal ||
            [options.prepare, options.configure, options.execute].every(
                (fn) => typeof fn === 'function',
            ),
        'Formal owned runtime requires concrete artifact, startup and UI drivers',
    );
    const launchLocal = !options.formal && process.env.E2E_D1_LOCAL === '1';
    const cmsRoot = fileURLToPath(new URL('../../', import.meta.url));
    const gatewayRoot = process.env.E2E_GATEWAY_ROOT;
    const templatesRoot = process.env.E2E_TEMPLATES_ROOT;
    const credentialsFile = process.env.E2E_DATABASE_ENV_FILE;
    assert.ok(
        gatewayRoot && templatesRoot && credentialsFile,
        'E2E_GATEWAY_ROOT, E2E_TEMPLATES_ROOT, E2E_DATABASE_ENV_FILE required',
    );
    const backendRequire = createRequire(
        path.join(cmsRoot, 'backend/package.json'),
    );
    const gatewayRequire = createRequire(
        path.join(gatewayRoot, 'package.json'),
    );
    const { Pool } = gatewayRequire('pg');
    const { MongoClient } = backendRequire('mongodb');
    const Fastify = backendRequire('fastify');
    const owned = Object.fromEntries(
        fs
            .readFileSync(credentialsFile, 'utf8')
            .trim()
            .split('\n')
            .map((line) => {
                const i = line.indexOf('=');
                return [line.slice(0, i), line.slice(i + 1)];
            }),
    );
    assert.ok(owned.E2E_DB_PASSWORD);
    process.umask(0o077);
    const identity = randomUUID().replaceAll('-', '');
    const runRoot = path.resolve(
        process.env.E2E_RUNTIME_DIR ||
            path.join(cmsRoot, '.e2e', 'c4-' + identity),
    );
    assert.ok(!fs.existsSync(runRoot), 'Use a new task-owned run directory');
    fs.mkdirSync(path.join(runRoot, 'backend/public'), {
        recursive: true,
        mode: 0o700,
    });
    fs.mkdirSync(path.join(runRoot, 'snapshots'), { recursive: true });
    const database = 'gateway_c4_' + identity,
        mongoDatabase = 'cms_c4_' + identity;
    const processes = new BrowserProcesses();
    const docker = (args) =>
        execFileSync('docker', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    const canonical = (value) =>
        Array.isArray(value)
            ? value.map(canonical)
            : value && typeof value === 'object'
              ? Object.fromEntries(
                    Object.keys(value)
                        .sort()
                        .map((k) => [k, canonical(value[k])]),
                )
              : value;
    const sha = (value) => createHash('sha256').update(value).digest('hex');
    const report = {
        evidenceType: options.formal
            ? 'formal-owned-runtime'
            : 'isolated-local-first-publication',
        formalLockAccepted: options.formal === true,
        publicWildcardDnsTls: options.formal
            ? 'requires live owned-host checks'
            : 'not verified',
        startedAt: new Date().toISOString(),
        runRoot,
        sites: [],
        source: {},
        checks: [],
        cleanup: {},
    };
    let sql,
        admin,
        mongo,
        app,
        traffic,
        tls,
        worker,
        cmsChild,
        networkOwned = false,
        token,
        cmsAddress;
    const containerIds = new Set();
    const serviceSecret = randomBytes(32).toString('hex'),
        challengeSecret = randomBytes(32).toString('hex');
    const txt = new Map();
    async function freePort() {
        const s = net.createServer();
        await new Promise((r) => s.listen(0, '127.0.0.1', r));
        const port = s.address().port;
        await new Promise((r) => s.close(r));
        return port;
    }
    async function until(check, label, ms = 60000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (await check()) return;
            await delay(150);
        }
        throw Error('Timed out: ' + label);
    }
    async function cms(route, body, site) {
        const response = await fetch(cmsAddress + '/api/v4' + route, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: 'Bearer ' + token } : {}),
                ...(site
                    ? {
                          'x-bcms-workspace': site.cmsWorkspaceId,
                          ...(site.cmsSiteId
                              ? { 'x-bcms-site': site.cmsSiteId }
                              : {}),
                      }
                    : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(15000),
        });
        const value = await response.json();
        assert.equal(
            response.status,
            200,
            route + ': ' + JSON.stringify(value),
        );
        return value;
    }
    async function main() {
        for (const [name, root] of [
            ['cms', cmsRoot],
            ['gateway', gatewayRoot],
            ['templates', templatesRoot],
            ...(process.env.E2E_PREVIEW_ROOT
                ? [['preview', process.env.E2E_PREVIEW_ROOT]]
                : []),
        ]) {
            const paths = [
                ...new Set(
                    execFileSync(
                        'git',
                        [
                            'ls-files',
                            '--modified',
                            '--others',
                            '--exclude-standard',
                        ],
                        { cwd: root, encoding: 'utf8' },
                    )
                        .trim()
                        .split('\n')
                        .filter(Boolean),
                ),
            ];
            report.source[name] = {
                head: execFileSync('git', ['rev-parse', 'HEAD'], {
                    cwd: root,
                    encoding: 'utf8',
                }).trim(),
                diffSha256: sha(
                    execFileSync('git', ['diff', 'HEAD', '--'], { cwd: root }),
                ),
                files: paths
                    .filter((file) =>
                        fs.statSync(path.join(root, file)).isFile(),
                    )
                    .map((file) => ({
                        path: file,
                        sha256: sha(fs.readFileSync(path.join(root, file))),
                    })),
            };
        }
        if (options.prepare) await options.prepare({ report, runRoot, docker });
        let info;
        if (!options.formal) {
            const image =
                process.env.E2E_C4_IMAGE || 'local/c4-aeroframe:source';
            info = JSON.parse(docker(['image', 'inspect', image]))[0];
            assert.equal(
                info.Config.Labels['org.opencontainers.image.revision'],
                report.source.templates.head,
                'Rebuild current template source before running',
            );
            report.image = {
                tag: image,
                dockerEngineImageId: info.Id,
                sourceCommit:
                    info.Config.Labels['org.opencontainers.image.revision'],
            };
        }
        const base = `postgresql://e2e:${encodeURIComponent(owned.E2E_DB_PASSWORD)}@127.0.0.1:15432/gateway_e2e`;
        admin = new Pool({ connectionString: base });
        await admin.query(`CREATE DATABASE "${database}"`);
        const databaseUrl = new URL(base);
        databaseUrl.pathname = '/' + database;
        Object.assign(process.env, {
            DATABASE_URL: databaseUrl.href,
            CMS_INSTANCE_ID: 'c4-' + identity,
            CMS_SERVICE_SECRET: serviceSecret,
            PLATFORM_DOMAIN: options.platformDomain || 'sites.localhost',
            STOREFRONT_DOMAIN_SECRET: challengeSecret,
            STOREFRONT_DOMAIN_ENTRY_HOST: 'edge.c4.localhost',
            SNAPSHOT_STORAGE_PATH: path.join(runRoot, 'snapshots'),
            ALLOWED_TEMPLATE_IDS: options.formal
                ? 'aeroframe,fireguard'
                : 'aeroframe',
            GATEWAY_APPROVED_IMAGE_DIGEST: options.formal ? '' : info.Id,
        });
        const migrate = spawnSync(
            process.execPath,
            ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
            { cwd: gatewayRoot, env: process.env, encoding: 'utf8' },
        );
        assert.equal(migrate.status, 0, 'SQL migrations');
        sql = new Pool({ connectionString: databaseUrl.href });
        const mongoUrl = `mongodb://e2e:${encodeURIComponent(owned.E2E_DB_PASSWORD)}@127.0.0.1:27029/${mongoDatabase}?authSource=admin`;
        mongo = new MongoClient(mongoUrl);
        await mongo.connect();
        process.env.TS_NODE_PROJECT = path.join(
            cmsRoot,
            'backend/tsconfig.json',
        );
        process.env.TS_NODE_TRANSPILE_ONLY = 'true';
        backendRequire('ts-node').register({
            project: process.env.TS_NODE_PROJECT,
            transpileOnly: true,
            moduleTypes: {
                [path.join(gatewayRoot, 'packages/contracts/src/**')]: 'cjs',
                [path.join(gatewayRoot, 'packages/worker/src/**')]: 'cjs',
            },
        });
        backendRequire('tsconfig-paths/register');
        const { provisionSite } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/provisioning.ts'),
        );
        const { authenticateCmsService } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/auth.ts'),
        );
        const domains = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/domains.ts'),
        );
        const { probeDomain, requestChallenge } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/domain-probe.ts'),
        );
        const leadHandlers = backendRequire(
            path.join(
                gatewayRoot,
                'apps/control/app/api/v1/sites/[siteId]/leads/route.ts',
            ),
        );
        const eventHandlers = backendRequire(
            path.join(
                gatewayRoot,
                'apps/control/app/api/v1/sites/[siteId]/events/route.ts',
            ),
        );
        const { readPublicationState } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/publication-state.ts'),
        );
        const { receiveRelease } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/releases.ts'),
        );
        const { readPublishOperation } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/publish-operation.ts'),
        );
        const { readPublishedRelease } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/published-release.ts'),
        );
        const { readSiteInfo } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/site-info.ts'),
        );
        const { updateTemplatePin } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/template-pin.ts'),
        );
        const { createPublishOperation } = backendRequire(
            path.join(gatewayRoot, 'apps/control/src/publish.ts'),
        );
        const { toContractSnapshot } = backendRequire(
            path.join(cmsRoot, 'backend/src/release-contract/snapshot.ts'),
        );
        const { createTrafficProxy } = await import(
            pathToFileURL(
                path.join(gatewayRoot, 'packages/traffic/dist/index.js'),
            )
        );
        traffic = createTrafficProxy(path.join(runRoot, 'routes.json'), {
            secret: challengeSecret,
        });
        await traffic.listen(0);
        if (!options.formal)
            execFileSync(
                'openssl',
                [
                    'req',
                    '-x509',
                    '-newkey',
                    'rsa:2048',
                    '-nodes',
                    '-keyout',
                    path.join(runRoot, 'key.pem'),
                    '-out',
                    path.join(runRoot, 'cert.pem'),
                    '-days',
                    '1',
                    '-subj',
                    '/CN=*.sites.localhost',
                    '-addext',
                    'subjectAltName=DNS:*.sites.localhost,DNS:custom.c4.localhost',
                ],
                { stdio: 'ignore' },
            );
        const ca = fs.readFileSync(
            options.certPath || path.join(runRoot, 'cert.pem'),
        );
        tls = tlsServer(
            {
                key: fs.readFileSync(
                    options.keyPath || path.join(runRoot, 'key.pem'),
                ),
                cert: ca,
            },
            (req, res) => {
                const upstream = httpRequest(
                    {
                        hostname: '127.0.0.1',
                        port: traffic.port(),
                        path: req.url,
                        method: req.method,
                        headers: req.headers,
                    },
                    (reply) => {
                        res.writeHead(reply.statusCode, reply.headers);
                        reply.pipe(res);
                    },
                );
                upstream.on('error', () => {
                    res.writeHead(502);
                    res.end();
                });
                req.pipe(upstream);
            },
        );
        await new Promise((r) =>
            tls.listen(
                options.formal ? 443 : 0,
                options.formal ? '0.0.0.0' : '127.0.0.1',
                r,
            ),
        );
        const tlsPort = tls.address().port;
        report.tlsPort = tlsPort;
        const localProbe = (record) =>
            probeDomain(record, {
                secret: challengeSecret,
                lookup: async () => [{ address: '127.0.0.1', family: 4 }],
                addressAllowed: (address) => address === '127.0.0.1',
                resolveTxt: async (host) => [[txt.get(host) || '']],
                request: (host, address, nonce) =>
                    requestChallenge(host, address, nonce, {
                        ca,
                        port: tlsPort,
                    }),
            });
        report.probeBoundary = options.formal
            ? 'Production DNS/address policy and TLS probe against supplied wildcard; no local resolver substitution'
            : 'Actual local HTTPS, certificate/hostname checks and HMAC; explicit loopback DNS resolver/address policy and fixture TXT; no Internet DNS claim.';
        app = Fastify();
        app.all('/api/v1/*', async (req, reply) => {
            const body =
                req.method === 'GET'
                    ? undefined
                    : JSON.stringify(req.body || {});
            const request = new Request('http://local' + req.url, {
                method: req.method,
                headers: req.headers,
                ...(body ? { body } : {}),
            });
            let response;
            const match = /^\/api\/v1\/sites\/([^/]+)(?:\/(.*))?$/.exec(
                req.url.split('?')[0],
            );
            if (req.url === '/api/v1/site-provisioning') {
                const authority = authenticateCmsService(
                    req.headers.authorization,
                );
                response = Response.json(
                    await provisionSite(
                        sql,
                        authority.instanceId,
                        req.body,
                        options.platformDomain || 'sites.localhost',
                    ),
                );
            } else if (match) {
                const [, siteId, route] = match;
                const action =
                    /^domains\/([^/]+)\/(check|primary|state|remove)$/.exec(
                        route,
                    );
                if (!route) response = await readSiteInfo(request, siteId, sql);
                else if (route === 'template-pin')
                    response = await updateTemplatePin(request, siteId, sql);
                else if (route === 'published-release')
                    response = await readPublishedRelease(request, siteId, sql);
                else if (route?.startsWith('publish-operations/'))
                    response = await readPublishOperation(
                        request,
                        siteId,
                        route.split('/')[1],
                        sql,
                    );
                else if (route === 'publication-state')
                    response = await readPublicationState(request, siteId, sql);
                else if (route === 'leads')
                    response = await leadHandlers[req.method](
                        request,
                        { params: Promise.resolve({ siteId }) },
                        sql,
                    );
                else if (route === 'events')
                    response = await eventHandlers.GET(
                        request,
                        { params: Promise.resolve({ siteId }) },
                        sql,
                    );
                else if (route === 'domains')
                    response =
                        req.method === 'GET'
                            ? await domains.readDomainState(
                                  request,
                                  siteId,
                                  sql,
                              )
                            : await domains.reserveDomain(request, siteId, sql);
                else if (action)
                    response =
                        action[2] === 'check'
                            ? await domains.checkReservedDomain(
                                  request,
                                  siteId,
                                  action[1],
                                  sql,
                                  options.formal ? undefined : localProbe,
                              )
                            : await domains.mutateDomain(
                                  request,
                                  siteId,
                                  action[1],
                                  action[2],
                                  sql,
                              );
                else if (route === 'releases')
                    response = await receiveRelease(request, siteId, sql);
                else if (route === 'publish-operations')
                    response = await createPublishOperation(
                        request,
                        siteId,
                        sql,
                    );
            }
            response ||= Response.json({ error: 'not_found' }, { status: 404 });
            reply.code(response.status);
            for (const [k, v] of response.headers) reply.header(k, v);
            return reply.send(await response.text());
        });
        const gatewayAddress = await app.listen({ host: '127.0.0.1', port: 0 });
        report.gatewayPort = app.server.address().port;
        try {
            docker(['network', 'inspect', 'gateway-sites']);
        } catch {
            docker(['network', 'create', 'gateway-sites']);
            networkOwned = true;
        }
        const log = fs.openSync(
            path.join(runRoot, 'worker.private.log'),
            'w',
            0o600,
        );
        worker = processes.spawn(
            process.execPath,
            [path.join(gatewayRoot, 'packages/worker/dist/index.js')],
            {
                cwd: gatewayRoot,
                env: {
                    ...process.env,
                    GATEWAY_CONTROL_URL: `http://host.docker.internal:${report.gatewayPort}`,
                    DOCKER_SOCKET_PATH:
                        process.env.DOCKER_SOCKET_PATH ||
                        path.join(process.env.HOME, '.docker/run/docker.sock'),
                    GATEWAY_ROUTE_STATE_PATH: path.join(runRoot, 'routes.json'),
                    GATEWAY_SNAPSHOT_HOST_DIR: path.join(runRoot, 'snapshots'),
                    GATEWAY_DOCKER_PLATFORM:
                        process.arch === 'arm64'
                            ? 'linux/arm64'
                            : 'linux/amd64',
                },
                stdio: ['ignore', log, log],
            },
        );
        fs.closeSync(log);
        const cmsPort = await freePort();
        cmsAddress = `http://127.0.0.1:${cmsPort}`;
        report.cmsPort = cmsPort;
        const cmsLog = path.join(runRoot, 'cms.private.log');
        const out = fs.openSync(cmsLog, 'w', 0o600);
        const env = {
            ...process.env,
            SERVER_PORT: String(cmsPort),
            NODE_ENV: 'production',
            DB_URL: mongoUrl,
            STORAGE_SCOPE: 'bcms',
            BD_PREFIX: 'bcms',
            JWT_SECRET: randomBytes(32).toString('hex'),
            JWT_SCOPE: 'c4-local',
            JWT_EXP_IN: '3600000',
            STOREFRONT_ENABLED: 'true',
            GATEWAY_BASE_URL: gatewayAddress,
            STOREFRONT_GATEWAY_SECRET: randomBytes(32).toString('hex'),
            PLUGINS: '',
        };
        for (const key of [
            'GATEWAY_SITE_BINDINGS',
            'GATEWAY_CMS_WORKSPACE_ID',
            'GATEWAY_CMS_SITE_ID',
            'GATEWAY_WORKSPACE_ID',
            'GATEWAY_SITE_ID',
            'GATEWAY_PUBLIC_SITE_URL',
        ])
            delete env[key];
        if (options.configure)
            Object.assign(
                env,
                await options.configure({
                    cmsAddress,
                    report,
                    runRoot,
                    processes,
                    freePort,
                    until,
                }),
            );
        cmsChild = processes.spawn(
            process.execPath,
            [
                '-r',
                backendRequire.resolve('ts-node/register'),
                '-r',
                backendRequire.resolve('tsconfig-paths/register'),
                path.join(cmsRoot, 'backend/src/main.ts'),
            ],
            {
                cwd: path.join(runRoot, 'backend'),
                env,
                stdio: ['ignore', out, out],
            },
        );
        fs.closeSync(out);
        await until(async () => {
            try {
                return (
                    await fetch(cmsAddress + '/api/v4/health-check', {
                        method: 'HEAD',
                    })
                ).ok;
            } catch {
                return false;
            }
        }, 'CMS main');
        let serverToken;
        await until(() => {
            serverToken = /Server token: ([a-f0-9]{128})/.exec(
                fs.readFileSync(cmsLog, 'utf8'),
            )?.[1];
            return !!serverToken;
        }, 'signup');
        const browserEmail = `c4-${identity}@acceptance.invalid`;
        const browserPassword = randomBytes(24).toString('hex');
        token = (
            await cms('/auth/signup-admin', {
                serverToken,
                email: browserEmail,
                password: browserPassword,
                firstName: 'C4',
                lastName: 'Local',
            })
        ).accessToken;
        let uiSites;
        if (launchLocal) {
            const buildLog = fs.openSync(
                path.join(runRoot, 'ui-build.private.log'),
                'w',
                0o600,
            );
            const build = processes.spawn(
                'npm',
                [
                    'run',
                    'build-only',
                    '--',
                    '--outDir',
                    path.join(runRoot, 'ui/dist'),
                ],
                {
                    cwd: path.join(cmsRoot, 'ui'),
                    env: {
                        ...process.env,
                        VITE_TEMPLATE_PREVIEW_ORIGIN: '',
                        VITE_TEMPLATE_PREVIEW_RENDERERS: '',
                        VITE_STOREFRONT_ORIGIN: '',
                    },
                    stdio: ['ignore', buildLog, buildLog],
                },
            );
            fs.closeSync(buildLog);
            assert.equal(
                await processes.exit(build),
                0,
                'Current-source UI build',
            );
            const browserLog = fs.openSync(
                path.join(runRoot, 'browser.private.log'),
                'w',
                0o600,
            );
            const browser = processes.spawn(
                process.execPath,
                [
                    'node_modules/@playwright/test/cli.js',
                    'test',
                    '--config',
                    'ops/e2e/playwright.config.mjs',
                    'ops/e2e/launch.spec.mjs',
                    '--project=desktop',
                ],
                {
                    cwd: cmsRoot,
                    env: {
                        ...process.env,
                        STOREFRONT_E2E_LAUNCH: '1',
                        STOREFRONT_E2E_LAUNCH_LOCAL: '1',
                        STOREFRONT_E2E_RUN_ID: identity,
                        STOREFRONT_E2E_CMS: cmsAddress,
                        STOREFRONT_E2E_EMAIL: browserEmail,
                        STOREFRONT_E2E_PASSWORD: browserPassword,
                        STOREFRONT_E2E_PRIVATE_DIR: path.join(
                            runRoot,
                            'private',
                        ),
                        STOREFRONT_E2E_RESULTS_DIR: path.join(
                            runRoot,
                            'browser',
                        ),
                        STOREFRONT_E2E_LAUNCH_RESULTS: path.join(
                            runRoot,
                            'ui-cases',
                        ),
                    },
                    stdio: ['ignore', browserLog, browserLog],
                },
            );
            fs.closeSync(browserLog);
            report.browserExit = await processes.exit(browser);
            assert.equal(
                report.browserExit,
                0,
                'Supplementary UI assertions must pass before worker proof',
            );
            uiSites = ['aeroframe', 'fireguard'].map((id) =>
                JSON.parse(
                    fs.readFileSync(
                        path.join(runRoot, 'ui-cases', id + '.json'),
                        'utf8',
                    ),
                ),
            );
            assert.ok(
                uiSites.every((item) => item.site),
                'Actual UI creation required before local worker proof',
            );
            report.browserScope =
                'Supplementary builtin aeroframe1.0.0 UI creation; exact two-template CREATE remains blocked when public catalog unavailable';
        }
        const publicGet = (host, url = '/') =>
            new Promise((resolve, reject) => {
                const req = tlsRequest(
                    {
                        hostname: host,
                        port: tlsPort,
                        ca,
                        servername: host,
                        lookup: (_h, options, cb) =>
                            options.all
                                ? cb(null, [
                                      { address: '127.0.0.1', family: 4 },
                                  ])
                                : cb(null, '127.0.0.1', 4),
                        path: url,
                        agent: false,
                    },
                    (res) => {
                        let body = '';
                        res.on('data', (x) => (body += x));
                        res.on('end', () =>
                            resolve({
                                status: res.statusCode,
                                body,
                                location: res.headers.location,
                            }),
                        );
                    },
                );
                req.on('error', reject);
                req.end();
            });
        if (options.execute) {
            await options.execute({
                report,
                runRoot,
                cmsRoot,
                gatewayRoot,
                templatesRoot,
                processes,
                sql,
                mongo,
                cms,
                cmsAddress,
                browserEmail,
                browserPassword,
                docker,
                cmsChild,
                worker,
                app,
                freePort,
                until,
                containerIds,
                publicGet,
                serviceSecret,
                identity,
            });
            report.assertionsPassed = true;
            return;
        }
        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(
                    templatesRoot,
                    'templates/aeroframe/1.0.4/template.json',
                ),
                'utf8',
            ),
        );
        let faultSeed;
        for (const name of ['Alpha', 'Beta']) {
            const fromUi = uiSites?.[name === 'Alpha' ? 0 : 1]?.site;
            const workspace = fromUi
                ? { _id: fromUi.cmsWorkspaceId }
                : await cms('/workspaces', { name });
            const selection = { cmsWorkspaceId: workspace._id, cmsSiteId: '' };
            const site = fromUi
                ? { _id: fromUi.cmsSiteId }
                : await cms(
                      '/workspaces/current/sites',
                      { name, requestKey: `c4-${identity}-${name}` },
                      selection,
                  );
            selection.cmsSiteId = site._id;
            let binding;
            await until(async () => {
                binding = await mongo
                    .db()
                    .collection('bcms_site_gateway_bindings')
                    .findOne({
                        cmsWorkspaceId: workspace._id,
                        cmsSiteId: site._id,
                    });
                return !!binding;
            }, 'scheduled automatic provisioning');
            const host = new URL(binding.siteUrl).hostname;
            report.sites.push({
                ...selection,
                siteId: binding.siteId,
                workspaceId: binding.workspaceId,
                host,
                name,
            });
            await until(async () => {
                try {
                    return (
                        (
                            await publicGet(
                                host,
                                '/.well-known/cms-domain-challenge?nonce=nonce-123',
                            )
                        ).status === 200
                    );
                } catch {
                    return false;
                }
            }, 'reserved snapshot');
            assert.equal((await publicGet(host)).status, 404);
            const listed = await cms('/site-domains', undefined, selection);
            assert.equal(listed.items.length, 1);
            const domainId = listed.items[0]._id;
            assert.equal(
                (await cms(`/site-domains/${domainId}/check`, {}, selection))
                    .ready,
                true,
            );
            assert.equal(
                (
                    await sql.query(
                        'SELECT * FROM "ActiveDeployment" WHERE "siteId"=$1',
                        [binding.siteId],
                    )
                ).rowCount,
                0,
            );
            const { challengeSignature } = backendRequire(
                path.join(cmsRoot, 'backend/src/site-domains/service.ts'),
            );
            assert.equal(
                (
                    await publicGet(
                        host,
                        '/.well-known/cms-domain-challenge?nonce=nonce-123',
                    )
                ).body,
                challengeSignature(host, 'nonce-123', challengeSecret),
            );
            await assert.rejects(
                requestChallenge(host, '127.0.0.1', 'nonce-123', {
                    port: tlsPort,
                }),
            );
            await assert.rejects(
                requestChallenge('wrong.localhost', '127.0.0.1', 'nonce-123', {
                    ca,
                    port: tlsPort,
                }),
            );
            await sql.query(
                'INSERT INTO "TemplatePin" ("id","siteId","templateId","version","imageDigest","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
                [randomUUID(), binding.siteId, 'aeroframe', '1.0.4', info.Id],
            );
            const snapshot = toContractSnapshot({
                schemaVersion: 1,
                workspaceId: binding.workspaceId,
                siteId: binding.siteId,
                language: 'en',
                pages: [
                    {
                        path: '/',
                        pageKey: 'home',
                        entryId: name,
                        content: {
                            kind: 'preset-page',
                            view: 'home',
                            preset: {
                                id: 'aeroframe',
                                version: '1.0.4',
                                name: manifest.name,
                                description: manifest.description,
                                ...manifest.presentation,
                            },
                            sections: ['hero'],
                            sectionConfigs: [
                                {
                                    type: 'hero',
                                    enabled: true,
                                    data: {
                                        title: `C4 ${name} public content`,
                                    },
                                },
                            ],
                            seo: { title: `C4 ${name}`, description: '' },
                            items: [],
                        },
                    },
                ],
                navigation: [],
                redirects: [],
                operations: {
                    seoTitle: name,
                    seoDescription: '',
                    contactFormEnabled: false,
                },
            });
            const bytes = Buffer.from(JSON.stringify(snapshot)),
                releaseId = randomUUID();
            const headers = {
                authorization: 'Bearer ' + serviceSecret,
                'content-type': 'application/json',
                'X-CMS-Workspace': selection.cmsWorkspaceId,
                'X-CMS-Site': selection.cmsSiteId,
            };
            async function gateway(route, body) {
                const response = await fetch(
                    `${gatewayAddress}/api/v1/sites/${binding.siteId}/${route}`,
                    { method: 'POST', headers, body: JSON.stringify(body) },
                );
                const value = await response.json();
                assert.equal(response.status, 201, JSON.stringify(value));
                return value;
            }
            await gateway('releases', {
                siteId: binding.siteId,
                releaseId,
                checksum: 'sha256:' + sha(bytes),
                metadata: {
                    templateId: 'aeroframe',
                    templateVersion: '1.0.4',
                    imageDigest: info.Id,
                    manifestChecksum:
                        'sha256:' + sha(JSON.stringify(canonical(manifest))),
                },
                snapshot: bytes.toString('base64'),
            });
            if (name === 'Alpha')
                faultSeed = {
                    snapshot,
                    binding,
                    gateway,
                    metadata: {
                        templateId: 'aeroframe',
                        templateVersion: '1.0.4',
                        imageDigest: info.Id,
                        manifestChecksum:
                            'sha256:' +
                            sha(JSON.stringify(canonical(manifest))),
                    },
                };
            const operation = await gateway('publish-operations', {
                releaseId,
                expectedRevision: 0,
                idempotencyKey: randomUUID(),
            });
            await until(
                async () => {
                    const row = (
                        await sql.query(
                            'SELECT "status","failureCode" FROM "PublishOperation" WHERE "id"=$1',
                            [operation.id],
                        )
                    ).rows[0];
                    if (row.status === 'failed')
                        throw Error('Publish ' + row.failureCode);
                    return row.status === 'ready';
                },
                'first publication',
                90000,
            );
            const response = await publicGet(host);
            assert.equal(response.status, 200);
            assert.ok(response.body.includes(`C4 ${name} public content`));
            report.checks.push({
                site: name,
                prepublish404: true,
                actualTlsChallenge: true,
                untrustedCaRejected: true,
                wrongHostnameRejected: true,
                firstPublication: true,
                contentSha256: sha(response.body),
            });
        }
        assert.notEqual(
            report.checks[0].contentSha256,
            report.checks[1].contentSha256,
        );
        if (launchLocal)
            report.faults = await (
                await import('./launch-faults.mjs')
            ).launchFaults({
                sql,
                docker,
                processes,
                cmsChild,
                worker,
                app,
                gatewayPort: report.gatewayPort,
                cmsAddress,
                gatewayRoot,
                runRoot,
                freePort,
                publicGet,
                sites: report.sites,
                seed: faultSeed,
                until,
                containerIds,
            });
        if (launchLocal) {
            const guardRoot = path.join(runRoot, 'guard-browser');
            const guardLog = fs.openSync(
                path.join(runRoot, 'guard-browser.private.log'),
                'w',
                0o600,
            );
            const canary = randomBytes(24).toString('hex');
            const guard = processes.spawn(
                process.execPath,
                [
                    'node_modules/@playwright/test/cli.js',
                    'test',
                    '--config',
                    'ops/e2e/playwright.config.mjs',
                    'ops/e2e/launch-guard-canary.spec.mjs',
                    '--project=desktop',
                ],
                {
                    cwd: cmsRoot,
                    env: {
                        ...process.env,
                        STOREFRONT_E2E_CMS: cmsAddress,
                        STOREFRONT_E2E_EMAIL: browserEmail,
                        STOREFRONT_E2E_PASSWORD: browserPassword,
                        STOREFRONT_E2E_GUARD_CANARY: '1',
                        STOREFRONT_E2E_PRIVATE_CANARY: canary,
                        STOREFRONT_E2E_RESULTS_DIR: guardRoot,
                        STOREFRONT_E2E_PRIVATE_DIR: path.join(
                            runRoot,
                            'private',
                        ),
                    },
                    stdio: ['ignore', guardLog, guardLog],
                },
            );
            fs.closeSync(guardLog);
            assert.equal(
                await processes.exit(guard),
                1,
                'Guard canary must fail closed',
            );
            const guardFiles = fs
                .readdirSync(guardRoot, { recursive: true })
                .filter((file) =>
                    fs.statSync(path.join(guardRoot, file)).isFile(),
                );
            assert.ok(
                guardFiles.some((file) =>
                    file.endsWith('failure-interaction-timeline.json'),
                ),
            );
            assert.ok(
                guardFiles.some((file) =>
                    file.endsWith('failure-sanitized.png'),
                ),
            );
            assert.equal(
                guardFiles.some((file) => /\.(zip|har|webm)$/.test(file)),
                false,
            );
            for (const file of guardFiles.filter((file) =>
                /\.(json|md|txt)$/.test(file),
            )) {
                const text = fs.readFileSync(
                    path.join(guardRoot, file),
                    'utf8',
                );
                for (const secret of [canary, browserEmail, browserPassword])
                    assert.equal(text.includes(secret), false);
                assert.equal(
                    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(
                        text,
                    ),
                    false,
                );
            }
            report.guardCanary = {
                expectedFailure: true,
                safeTimelineRetained: true,
                maskedScreenshotRetained: true,
                secretsAbsent: true,
            };
            const marker = 'D1 lead ' + identity;
            const otherMarker = 'D1 other ' + identity;
            const eventPath = '/d1-' + identity;
            const otherEventPath = '/d1-other-' + identity;
            async function intake(site, route, body) {
                const response = await fetch(
                    `http://127.0.0.1:${report.faults.ingestPort}/api/v1/sites/${site.siteId}/${route}`,
                    {
                        method: 'POST',
                        headers: {
                            origin: 'https://' + site.host,
                            'content-type': 'application/json',
                        },
                        body: JSON.stringify(body),
                    },
                );
                assert.ok(
                    [200, 202].includes(response.status),
                    'Actual intake accepts owned origin: ' +
                        response.status +
                        ' ' +
                        (await response.clone().text()),
                );
                return response.json();
            }
            await intake(report.sites[0], 'leads', {
                source: 'contact',
                name: marker,
                email: 'd1@acceptance.invalid',
                message: marker,
                idempotencyKey: identity,
            });
            await intake(report.sites[1], 'leads', {
                source: 'contact',
                name: otherMarker,
                email: 'd1-other@acceptance.invalid',
                message: otherMarker,
                idempotencyKey: identity,
            });
            const event = {
                eventId: randomUUID(),
                path: eventPath,
                visitorId: 'd1-' + identity,
            };
            assert.equal(
                (await intake(report.sites[0], 'events', event)).duplicate,
                false,
            );
            assert.equal(
                (await intake(report.sites[0], 'events', event)).duplicate,
                true,
            );
            const otherEvent = {
                ...event,
                eventId: randomUUID(),
                path: otherEventPath,
            };
            assert.equal(
                (await intake(report.sites[1], 'events', otherEvent)).duplicate,
                false,
            );
            assert.equal(
                (await intake(report.sites[1], 'events', otherEvent)).duplicate,
                true,
            );
            const inputPath = path.join(runRoot, 'operations-input.json');
            fs.writeFileSync(
                inputPath,
                JSON.stringify({
                    marker,
                    otherMarker,
                    eventPath,
                    otherEventPath,
                    runId: process.env.STOREFRONT_E2E_RUN_ID || identity,
                    scope: 'actual-local-CMS-Gateway-intake-browser',
                    first: {
                        ...report.sites[0],
                        mediaId: uiSites[0].mediaId,
                        target: { id: 'aeroframe', version: '1.0.0', origin: 'builtin' },
                    },
                    second: {
                        ...report.sites[1],
                        mediaId: uiSites[1].mediaId,
                        target: { id: 'aeroframe', version: '1.0.0', origin: 'builtin' },
                    },
                }),
                { mode: 0o600 },
            );
            const log = fs.openSync(
                path.join(runRoot, 'operations-browser.private.log'),
                'w',
                0o600,
            );
            const browser = processes.spawn(
                process.execPath,
                [
                    'node_modules/@playwright/test/cli.js',
                    'test',
                    '--config',
                    'ops/e2e/playwright.config.mjs',
                    'ops/e2e/launch-operations.spec.mjs',
                    '--project=desktop',
                ],
                {
                    cwd: cmsRoot,
                    env: {
                        ...process.env,
                        STOREFRONT_E2E_CMS: cmsAddress,
                        STOREFRONT_E2E_EMAIL: browserEmail,
                        STOREFRONT_E2E_PASSWORD: browserPassword,
                        STOREFRONT_E2E_OPERATIONS: inputPath,
                        STOREFRONT_E2E_RESULTS_DIR: path.join(
                            runRoot,
                            'operations-browser',
                        ),
                        STOREFRONT_E2E_PRIVATE_DIR: path.join(
                            runRoot,
                            'private',
                        ),
                    },
                    stdio: ['ignore', log, log],
                },
            );
            fs.closeSync(log);
            report.operationsBrowserExit = await processes.exit(browser);
            assert.equal(
                report.operationsBrowserExit,
                0,
                'Actual lead/analytics browser workflow',
            );
        }
        const first = report.sites[0],
            second = report.sites[1];
        const added = await cms(
            '/site-domains',
            { hostname: 'custom.c4.localhost' },
            first,
        );
        txt.set(added.txtName, added.txtValue);
        await until(async () => {
            try {
                return (
                    (
                        await publicGet(
                            'custom.c4.localhost',
                            '/.well-known/cms-domain-challenge?nonce=nonce-123',
                        )
                    ).status === 200
                );
            } catch {
                return false;
            }
        }, 'custom snapshot');
        assert.equal(
            (await cms(`/site-domains/${added.id}/check`, {}, first)).ready,
            true,
        );
        const queued = await cms(
            `/site-domains/${added.id}/primary`,
            {},
            first,
        );
        assert.equal(queued.status, 'pending');
        await until(async () => {
            const list = await cms('/site-domains', undefined, first);
            return list.gateway.operation?.status === 'succeeded';
        }, 'domain switch');
        assert.deepEqual(await publicGet(first.host, '/catalog?sort=new'), {
            status: 301,
            body: '',
            location: 'https://custom.c4.localhost/catalog?sort=new',
        });
        assert.equal((await publicGet('custom.c4.localhost')).status, 200);
        const foreign = await fetch(
            `${gatewayAddress}/api/v1/sites/${second.siteId}/domains/${added.id}/primary`,
            {
                method: 'POST',
                headers: {
                    authorization: 'Bearer ' + serviceSecret,
                    'content-type': 'application/json',
                    'X-CMS-Workspace': first.cmsWorkspaceId,
                    'X-CMS-Site': first.cmsSiteId,
                },
                body: '{}',
            },
        );
        assert.equal(foreign.status, 404);
        assert.equal(
            (
                await publicGet(
                    'unknown.sites.localhost',
                    '/.well-known/cms-domain-challenge?nonce=nonce-123',
                )
            ).status,
            404,
        );
        assert.equal(
            (
                await publicGet(
                    first.host,
                    '/.well-known/cms-domain-challenge?nonce=a%20b',
                )
            ).status,
            400,
        );
        const ownerHeaders = {
            authorization: 'Bearer ' + serviceSecret,
            'content-type': 'application/json',
            'X-CMS-Workspace': first.cmsWorkspaceId,
            'X-CMS-Site': first.cmsSiteId,
        };
        const reserve = () =>
            fetch(`${gatewayAddress}/api/v1/sites/${first.siteId}/domains`, {
                method: 'POST',
                headers: ownerHeaders,
                body: JSON.stringify({ hostname: 'race.c4.localhost' }),
            });
        assert.deepEqual(
            (await Promise.all([reserve(), reserve()]))
                .map((x) => x.status)
                .sort(),
            [201, 409],
        );
        report.checks.push({
            customTxtAndTls: true,
            primarySwitch: true,
            alias301PreservesPathQuery: true,
            foreignDenied: true,
            unknownDenied: true,
            concurrentReservationDenied: true,
        });
        const bad = await cms(
            '/site-domains',
            { hostname: 'bad.c4.localhost' },
            first,
        );
        txt.set(bad.txtName, bad.txtValue);
        await delay(1200);
        const failed = await cms(`/site-domains/${bad.id}/check`, {}, first);
        assert.equal(failed.ready, false);
        assert.equal(failed.ownership, true);
        assert.equal(failed.https, false);
        const denied = await fetch(
            cmsAddress + `/api/v4/site-domains/${bad.id}/primary`,
            {
                method: 'POST',
                headers: {
                    authorization: 'Bearer ' + token,
                    'content-type': 'application/json',
                    'x-bcms-workspace': first.cmsWorkspaceId,
                    'x-bcms-site': first.cmsSiteId,
                },
                body: '{}',
            },
        );
        assert.equal(denied.status, 409);
        assert.equal((await publicGet('custom.c4.localhost')).status, 200);
        assert.equal(
            (await publicGet(first.host, '/unchanged?proof=1')).location,
            'https://custom.c4.localhost/unchanged?proof=1',
        );
        report.checks.push({
            failedCertificateCannotPromote: true,
            previousPrimaryRetained: true,
        });
        assert.equal(
            await mongo.db().collection('bcms_site_domains').countDocuments({}),
            0,
        );
        report.checks.push({ noLegacyDomainWrites: true });
        if (launchLocal)
            assert.equal(
                report.browserExit,
                0,
                'Supplementary UI assertions must pass independently of worker evidence',
            );
        report.assertionsPassed = true;
    }
    let failure;
    try {
        await main();
    } catch (error) {
        failure = error;
        report.failure = error.message;
        fs.writeFileSync(
            path.join(runRoot, 'failure.json'),
            JSON.stringify(
                { failure: error.message, checks: report.checks },
                null,
                2,
            ),
        );
    } finally {
        await processes.stop();
        if (sql) {
            const rows = await sql.query('SELECT "id" AS "siteId" FROM "Site"');
            for (const row of rows.rows) {
                for (const id of docker([
                    'ps',
                    '-aq',
                    '--filter',
                    `label=gateway.site-id=${row.siteId}`,
                ])
                    .split('\n')
                    .filter(Boolean))
                    containerIds.add(id);
            }
        }
        for (const id of containerIds) docker(['rm', '-f', id]);
        if (options.close) await options.close();
        if (tls) {
            tls.closeAllConnections();
            await new Promise((r) => tls.close(r));
        }
        if (traffic) await traffic.close();
        if (app) await app.close();
        if (mongo) {
            await mongo.db().dropDatabase();
            await mongo.close();
        }
        if (sql) await sql.end();
        if (admin) {
            await admin.query(
                `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
            );
            report.cleanup.sqlAbsent =
                (
                    await admin.query(
                        'SELECT datname FROM pg_database WHERE datname=$1',
                        [database],
                    )
                ).rowCount === 0;
            await admin.end();
        }
        if (networkOwned) docker(['network', 'rm', 'gateway-sites']);
        report.cleanup.processGroups = processes.liveGroups();
        report.cleanup.containers = [...containerIds];
        report.cleanup.mongoDropped = !!mongo;
        if (mongo) {
            const audit = new MongoClient(
                `mongodb://e2e:${encodeURIComponent(owned.E2E_DB_PASSWORD)}@127.0.0.1:27029/admin?authSource=admin`,
            );
            await audit.connect();
            report.cleanup.mongoAbsent = !(
                await audit
                    .db('admin')
                    .admin()
                    .listDatabases({ nameOnly: true })
            ).databases.some((item) => item.name === mongoDatabase);
            await audit.close();
        }
        report.cleanup.remainingContainers = [...containerIds].filter((id) => {
            try {
                docker(['inspect', id]);
                return true;
            } catch {
                return false;
            }
        });
        report.cleanup.portsClosed = {};
        for (const [kind, port] of Object.entries({
            cms: report.cmsPort,
            gateway: report.gatewayPort,
            tls: report.tlsPort,
            preview: report.previewPort,
        })) {
            if (port)
                report.cleanup.portsClosed[kind] = await new Promise(
                    (resolve) => {
                        const socket = net.connect({ host: '127.0.0.1', port });
                        socket.once('connect', () => {
                            socket.destroy();
                            resolve(false);
                        });
                        socket.once('error', () => {
                            socket.destroy();
                            resolve(true);
                        });
                    },
                );
        }
        assert.equal(report.cleanup.processGroups.length, 0);
        assert.equal(report.cleanup.remainingContainers.length, 0);
        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(
            path.join(runRoot, 'evidence.json'),
            JSON.stringify(report, null, 2) + '\n',
        );
    }
    return report;
}
