// Actual independent-directory restore; explicitly source-only until formal inputs exist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { runOwnedFixture } from './owned-runtime.mjs';
const cmsRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (x) =>
    Array.isArray(x)
        ? x.map(canonical)
        : x && typeof x === 'object'
          ? Object.fromEntries(
                Object.keys(x)
                    .sort()
                    .map((k) => [k, canonical(x[k])]),
            )
          : x;
const run = (exe, args, options = {}) =>
    new Promise((resolve, reject) => {
        const child = spawn(exe, args, {
            ...options,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '',
            err = '';
        child.stdout.on('data', (x) => (out += x));
        child.stderr.on('data', (x) => (err += x));
        child.on('error', reject);
        child.on('exit', (code) =>
            code === 0
                ? resolve(out)
                : reject(
                      Error(
                          'Owned drill command failed: ' +
                              path.basename(exe) +
                              '; ' +
                              err.slice(-1200),
                      ),
                  ),
        );
    });
const get = (port, host, url = '/') =>
    new Promise((resolve, reject) => {
        const req = request(
            {
                host: '127.0.0.1',
                port,
                path: url,
                headers: { host },
                timeout: 5000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (x) => chunks.push(x));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        body: Buffer.concat(chunks),
                        location: res.headers.location,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy());
        req.end();
    });
if (process.env.E2E_F2_MODE !== 'local')
    throw Error(
        'F2 formal drill BLOCKED: independently verified complete public PlatformLock/artifacts required. Explicit E2E_F2_MODE=local runs source-only owned recovery.',
    );
const result = await runOwnedFixture({
    execute: async (context) => {
        const {
            report,
            runRoot,
            gatewayRoot,
            templatesRoot,
            processes,
            mongo,
            cms,
            cmsEnv,
            cmsToken,
            worker,
            cmsChild,
            app,
            freePort,
            until,
            containerIds,
            publicGet,
            serviceSecret,
            identity,
        } = context;
        let sql = context.sql,
            restoredMongo,
            traffic,
            restoredWorker,
            restoredCms;
        let sourceWorker = worker,
            sourceCms = cmsChild;
        const gatewayRequire = createRequire(
            path.join(gatewayRoot, 'package.json'),
        );
        const backendRequire = createRequire(
            path.join(cmsRoot, 'backend/package.json'),
        );
        const { MongoClient } = backendRequire('mongodb');
        const { toContractSnapshot } = backendRequire(
            path.join(cmsRoot, 'backend/src/release-contract/snapshot.ts'),
        );
        const gatewayAddress = 'http://127.0.0.1:' + report.gatewayPort;
        const image = JSON.parse(
            context.docker([
                'image',
                'inspect',
                process.env.E2E_C4_IMAGE || 'local/f2-aeroframe:source',
            ]),
        )[0];
        const proof = {
            evidenceType: 'source-only-local-independent-directory',
            formalLockAccepted: false,
            checks: [],
            samples: [],
            cleanup: {},
        };
        report.disasterRecovery = proof;
        const backups = path.join(runRoot, 'backup'),
            restore = path.join(runRoot, 'restored');
        const uploads = path.join(runRoot, 'backend/uploads');
        fs.mkdirSync(uploads, { recursive: true });
        const media = fs.readFileSync(
            path.join(cmsRoot, 'ops/e2e/fixtures/acceptance.png'),
        );
        fs.writeFileSync(path.join(uploads, 'dr.png'), media);
        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(
                    templatesRoot,
                    'templates/aeroframe/1.0.4/template.json',
                ),
            ),
        );
        const workspace = await cms('/workspaces', { name: 'F2 recovery' }),
            selection = { cmsWorkspaceId: workspace._id, cmsSiteId: '' };
        const site = await cms(
            '/workspaces/current/sites',
            { name: 'F2 recovery', requestKey: 'f2-' + identity },
            selection,
        );
        selection.cmsSiteId = site._id;
        let binding;
        await until(
            async () =>
                !!(binding = await mongo
                    .db()
                    .collection('bcms_site_gateway_bindings')
                    .findOne({ ...selection })),
            'F2 automatic provisioning',
        );
        const host = new URL(binding.siteUrl).hostname;
        report.sites.push({
            ...selection,
            siteId: binding.siteId,
            workspaceId: binding.workspaceId,
            host,
        });
        const domain = (await cms('/site-domains', undefined, selection))
            .items[0];
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
        }, 'F2 reserved domain');
        assert.equal(
            (await cms(`/site-domains/${domain._id}/check`, {}, selection))
                .ready,
            true,
        );
        await sql.query(
            'INSERT INTO "TemplatePin" (id,"siteId","templateId",version,"imageDigest","updatedAt") VALUES ($1,$2,\'aeroframe\',\'1.0.4\',$3,now())',
            [randomUUID(), binding.siteId, image.Id],
        );
        const preset = {
            id: 'aeroframe',
            version: '1.0.4',
            name: manifest.name,
            description: manifest.description,
            ...manifest.presentation,
        };
        const content = (view, title) => ({
            kind: 'preset-page',
            view,
            preset,
            sections:
                view === 'home'
                    ? ['hero']
                    : ['gallery', 'information', 'description'],
            sectionConfigs:
                view === 'home'
                    ? [{ type: 'hero', enabled: true, data: { title } }]
                    : [
                          {
                              type: 'gallery',
                              enabled: true,
                              data: { image: '/_assets/dr.png' },
                          },
                          {
                              type: 'information',
                              enabled: true,
                              data: { title, price: '$42' },
                          },
                          {
                              type: 'description',
                              enabled: true,
                              data: { body: 'Restored product description' },
                          },
                      ],
            seo: { title, description: '' },
            items: [],
        });
        const snapshot = toContractSnapshot(
            {
                schemaVersion: 1,
                workspaceId: binding.workspaceId,
                siteId: binding.siteId,
                language: 'en',
                pages: [
                    {
                        path: '/',
                        pageKey: 'home',
                        entryId: 'home',
                        content: content('home', 'F2 original home'),
                    },
                    {
                        path: '/products/widget',
                        pageKey: 'product',
                        entryId: 'product',
                        content: content('product', 'F2 recovery widget'),
                    },
                ],
                navigation: [
                    {
                        id: 'product',
                        label: 'Widget',
                        href: '/products/widget',
                        enabled: true,
                        children: [],
                    },
                ],
                redirects: [{ from: '/old-widget', to: '/products/widget' }],
                operations: {
                    seoTitle: 'F2',
                    seoDescription: '',
                    contactFormEnabled: false,
                },
            },
            [
                {
                    path: 'dr.png',
                    checksum: 'sha256:' + hash(media),
                    mimeType: 'image/png',
                    url: '/_assets/dr.png',
                    contentBase64: media.toString('base64'),
                },
            ],
        );
        const metadata = {
            templateId: 'aeroframe',
            templateVersion: '1.0.4',
            imageDigest: image.Id,
            manifestChecksum:
                'sha256:' + hash(JSON.stringify(canonical(manifest))),
        };
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
        async function uploadRelease(value) {
            const bytes = Buffer.from(JSON.stringify(value)),
                releaseId = randomUUID();
            await gateway('releases', {
                siteId: binding.siteId,
                releaseId,
                checksum: 'sha256:' + hash(bytes),
                metadata,
                snapshot: bytes.toString('base64'),
            });
            return releaseId;
        }
        async function publish(releaseId, revision) {
            const op = await gateway('publish-operations', {
                releaseId,
                expectedRevision: revision,
                idempotencyKey: randomUUID(),
            });
            await until(
                async () => {
                    const row = (
                        await sql.query(
                            'SELECT status,"failureCode" FROM "PublishOperation" WHERE id=$1',
                            [op.id],
                        )
                    ).rows[0];
                    assert.notEqual(row.status, 'failed', row.failureCode);
                    return row.status === 'ready';
                },
                'F2 real Docker publish',
                90000,
            );
            return op;
        }
        const originalReleaseId = await uploadRelease(snapshot);
        await publish(originalReleaseId, 0);
        const activeSnapshot = structuredClone(snapshot);
        activeSnapshot.pages[0].content.sectionConfigs[0].data.title =
            'F2 active home';
        const releaseId = await uploadRelease(activeSnapshot);
        await publish(releaseId, 1);
        const oldRoutes = JSON.parse(
                fs.readFileSync(path.join(runRoot, 'routes.json')),
            ),
            oldRoute = oldRoutes.routes.find(
                (r) => r.siteId === binding.siteId,
            );
        containerIds.add(oldRoute.containerId);
        assert.equal((await publicGet(host)).status, 200);
        await mongo
            .db()
            .collection('f2_content')
            .insertOne({
                _id: 'product',
                title: 'F2 recovery widget',
                image: 'dr.png',
                draft: 'original draft',
                requestKey: 'restore-preserve',
            });
        await mongo
            .db()
            .collection('f2_jobs')
            .insertOne({
                _id: 'pending',
                creationRequestKey: 'retained',
                provisioning: {
                    requestKey: 'retained',
                    status: 'running',
                    attempts: 2,
                    leaseToken: 'dead-owned-lease',
                    leaseUntil: 0,
                },
            });
        const originalSql = await sql.query(
            'SELECT b.*,d.hostname FROM "SourceSiteBinding" b JOIN "Domain" d ON d.id=b."defaultDomainId" WHERE b."siteId"=$1',
            [binding.siteId],
        );
        const originalMongo = await mongo
            .db()
            .collection('bcms_site_gateway_bindings')
            .findOne({ ...selection });
        const database = new URL(context.databaseUrl).pathname.slice(1),
            mongoDatabase = mongo.db().databaseName;
        const dbConfig = {
            postgresContainer: 'platform-delivery-a1-20261106-postgres-1',
            mongoContainer: 'platform-delivery-a1-20261106-mongo-1',
            postgresDatabase: database,
            mongoDatabase,
            quiescenceTimeout: 10,
        };
        const sourceIdentity = path.join(runRoot, 'source-identity.json');
        fs.writeFileSync(
            sourceIdentity,
            JSON.stringify({
                evidenceType: 'source-only-local',
                source: report.source,
                image: report.image,
            }),
        );
        const privateConfig = {
            databases: dbConfig,
            backup: backups,
            restore,
            paths: {
                artifacts: path.join(runRoot, 'snapshots'),
                uploads,
                'routes.json': path.join(runRoot, 'routes.json'),
                'domains.json': path.join(runRoot, 'domains.json'),
                'platform-lock.json': sourceIdentity,
            },
        };
        const configPath = path.join(runRoot, 'dr-config.private.json');
        const credentials = Object.fromEntries(
            fs
                .readFileSync(process.env.E2E_DATABASE_ENV_FILE, 'utf8')
                .trim()
                .split('\n')
                .map((line) => [
                    line.slice(0, line.indexOf('=')),
                    line.slice(line.indexOf('=') + 1),
                ]),
        );
        const toolEnv = {
            ...process.env,
            PLATFORM_PG_USER: 'e2e',
            PLATFORM_PG_PASSWORD: credentials.E2E_DB_PASSWORD,
            PLATFORM_MONGO_URI: `mongodb://e2e:${encodeURIComponent(credentials.E2E_DB_PASSWORD)}@127.0.0.1:27017/admin?authSource=admin`,
        };
        const stop = async (child) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            processes.signalGroup(child.pid, 'SIGTERM');
            await until(
                () =>
                    Promise.resolve(
                        child.exitCode !== null || child.signalCode !== null,
                    ),
                'owned writer graceful exit',
                190000,
            );
        };
        const startWorker = (url, root) => {
            const log = fs.openSync(
                path.join(root, 'worker.private.log'),
                'a',
                0o600,
            );
            const child = processes.spawn(
                process.execPath,
                [path.join(gatewayRoot, 'packages/worker/dist/index.js')],
                {
                    cwd: gatewayRoot,
                    env: {
                        ...process.env,
                        DATABASE_URL: url,
                        GATEWAY_CONTROL_URL: `http://host.docker.internal:${report.gatewayPort}`,
                        DOCKER_SOCKET_PATH:
                            process.env.DOCKER_SOCKET_PATH ||
                            path.join(
                                process.env.HOME,
                                '.docker/run/docker.sock',
                            ),
                        GATEWAY_ROUTE_STATE_PATH: path.join(
                            root,
                            'routes.json',
                        ),
                        GATEWAY_SNAPSHOT_HOST_DIR: path.join(
                            root,
                            root === runRoot ? 'snapshots' : 'artifacts',
                        ),
                    },
                    stdio: ['ignore', log, log],
                },
            );
            fs.closeSync(log);
            return child;
        };
        const startCms = async (url, root, port) => {
            fs.mkdirSync(path.join(root, 'public'), { recursive: true });
            const log = fs.openSync(
                path.join(root, 'cms.private.log'),
                'a',
                0o600,
            );
            const child = processes.spawn(
                process.execPath,
                cmsChild.spawnargs.slice(1),
                {
                    cwd: root,
                    env: { ...cmsEnv, DB_URL: url, SERVER_PORT: String(port) },
                    stdio: ['ignore', log, log],
                },
            );
            fs.closeSync(log);
            await until(async () => {
                try {
                    return (
                        (
                            await fetch(
                                `http://127.0.0.1:${port}/api/v4/auth/server-token`,
                            )
                        ).status < 500
                    );
                } catch {
                    return false;
                }
            }, 'restored CMS startup');
            return child;
        };
        let sampling = true;
        const sampler = (async () => {
            while (sampling) {
                try {
                    proof.samples.push({
                        at: new Date().toISOString(),
                        status: (await publicGet(host)).status,
                    });
                } catch {
                    proof.samples.push({
                        at: new Date().toISOString(),
                        status: 0,
                    });
                }
                await delay(100);
            }
        })();
        let restoredUrl;
        try {
            const started = Date.now();
            await context.setMaintenance(true);
            assert.equal(
                (
                    await fetch(
                        gatewayAddress + '/api/v1/sites/' + binding.siteId,
                        { headers },
                    )
                ).status,
                503,
            );
            await stop(sourceCms);
            await stop(sourceWorker);
            await context.disconnectDatabase();
            // Preserve a crash-window current route plus a future domain retry, after writers stop.
            sql = context.reconnectDatabase();
            const domainChangeId = randomUUID();
            await sql.query(
                'INSERT INTO "DomainChange" ("siteId",id,"domainId",operation,status,"retryAfter") VALUES ($1,$2,$3,\'primary\',\'pending\',now()+interval \'1 hour\')',
                [binding.siteId, domainChangeId, domain._id],
            );
            await sql.query(
                'UPDATE "PublishOperation" SET "leaseOwner"=\'dead-owned-worker\',"leaseUntil"=now()-interval \'1 hour\',"candidateCredentialHash"=$1 WHERE "siteId"=$2 AND "releaseId"=$3',
                ['a'.repeat(64), binding.siteId, releaseId],
            );
            proof.domainRetryBefore = (
                await sql.query(
                    'SELECT * FROM "DomainChange" WHERE "siteId"=$1',
                    [binding.siteId],
                )
            ).rows[0];
            await context.disconnectDatabase();
            const crashState = JSON.parse(
                fs.readFileSync(path.join(runRoot, 'routes.json')),
            );
            crashState.routes.push({
                ...oldRoute,
                siteId: randomUUID(),
                host: 'unresolved.sites.localhost',
                revision: 91,
            });
            fs.writeFileSync(
                path.join(runRoot, 'routes.json'),
                JSON.stringify(crashState),
            );
            privateConfig.stoppedPids = [sourceCms.pid, sourceWorker.pid];
            fs.writeFileSync(configPath, JSON.stringify(privateConfig));
            try {
                await run(
                    'python3',
                    [
                        path.join(cmsRoot, 'ops/e2e/disaster-recovery.py'),
                        'backup',
                        configPath,
                    ],
                    { cwd: cmsRoot, env: toolEnv },
                );
            } finally {
                sql = context.reconnectDatabase();
                sourceWorker = startWorker(context.databaseUrl, runRoot);
                sourceCms = await startCms(
                    context.mongoUrl,
                    path.join(runRoot, 'backend'),
                    report.cmsPort,
                );
                await context.setMaintenance(false);
            }
            proof.backupMs = Date.now() - started;
            proof.dataTimestamp = JSON.parse(
                fs.readFileSync(path.join(backups, 'manifest.json')),
            ).createdAt;
            sampling = false;
            await sampler;
            assert.ok(
                proof.samples.length > 2 &&
                    proof.samples.every((s) => s.status === 200),
            );
            proof.originalWriterSet = [
                'cms/provisioning',
                'control/domain-probes/ingest',
                'worker/reconciliation/domain-retry',
            ];
            proof.resumedOriginalSet = true;
            await context.setMaintenance(true);
            await stop(sourceCms);
            await stop(sourceWorker);
            await context.disconnectDatabase();
            const restoreStarted = Date.now();
            context.docker(['rm', '-f', oldRoute.containerId]);
            const receipt = JSON.parse(
                await run(
                    'python3',
                    [
                        path.join(cmsRoot, 'ops/e2e/disaster-recovery.py'),
                        'restore',
                        configPath,
                    ],
                    { cwd: cmsRoot, env: toolEnv },
                ),
            );
            const url = new URL(context.databaseUrl);
            url.pathname = '/' + receipt.postgresDatabase;
            restoredUrl = url.href;
            const mu = new URL(context.mongoUrl);
            mu.pathname = '/' + receipt.mongoDatabase;
            restoredMongo = new MongoClient(mu.href);
            await restoredMongo.connect();
            assert.deepEqual(
                await restoredMongo
                    .db()
                    .collection('bcms_site_gateway_bindings')
                    .findOne({ ...selection }),
                originalMongo,
            );
            assert.equal(
                (
                    await restoredMongo
                        .db()
                        .collection('f2_content')
                        .findOne({ _id: 'product' })
                ).title,
                'F2 recovery widget',
            );
            const job = await restoredMongo
                .db()
                .collection('f2_jobs')
                .findOne({ _id: 'pending' });
            assert.equal(job.provisioning.status, 'pending');
            assert.equal(job.provisioning.requestKey, 'retained');
            assert.equal(job.provisioning.leaseToken, undefined);
            await run(
                process.execPath,
                [
                    path.join(
                        gatewayRoot,
                        'packages/worker/dist/restore-deployments.js',
                    ),
                    restore,
                ],
                {
                    cwd: gatewayRoot,
                    env: {
                        ...process.env,
                        DATABASE_URL: restoredUrl,
                        GATEWAY_CONTROL_URL: `http://host.docker.internal:${report.gatewayPort}`,
                        DOCKER_SOCKET_PATH:
                            process.env.DOCKER_SOCKET_PATH ||
                            path.join(
                                process.env.HOME,
                                '.docker/run/docker.sock',
                            ),
                        PLATFORM_RESTORE_LOCAL_IMAGE: image.Id,
                    },
                },
            );
            const route = JSON.parse(
                fs.readFileSync(path.join(restore, 'routes.json')),
            ).routes.find((r) => r.siteId === binding.siteId);
            containerIds.add(route.containerId);
            assert.notEqual(route.containerId, oldRoute.containerId);
            assert.notEqual(route.port, oldRoute.port);
            assert.equal(route.releaseId, releaseId);
            assert.equal(route.revision, 2);
            const { createTrafficProxy } = await import(
                pathToFileURL(
                    path.join(gatewayRoot, 'packages/traffic/dist/index.js'),
                )
            );
            traffic = createTrafficProxy(path.join(restore, 'routes.json'));
            await traffic.listen(0);
            report.additionalPorts = {
                restoredTraffic: traffic.port(),
                restoredRuntime: route.port,
            };
            for (const [url, marker] of [
                ['/', 'F2 active home'],
                ['/products/widget', 'F2 recovery widget'],
                ['/sitemap.xml', '/products/widget'],
            ]) {
                const response = await get(traffic.port(), host, url);
                assert.equal(response.status, 200);
                assert.ok(response.body.toString().includes(marker));
                proof.checks.push({
                    url,
                    status: 200,
                    sha256: hash(response.body),
                });
            }
            const imageResponse = await get(
                traffic.port(),
                host,
                '/_assets/dr.png',
            );
            assert.equal(imageResponse.status, 200);
            assert.deepEqual(imageResponse.body, media);
            const redirect = await get(traffic.port(), host, '/old-widget');
            assert.equal(redirect.status, 308);
            assert.equal(redirect.location, '/products/widget');
            assert.deepEqual(
                fs.readFileSync(path.join(restore, 'uploads/dr.png')),
                media,
            );
            sql = context.reconnectDatabase(restoredUrl);
            assert.deepEqual(
                (
                    await sql.query(
                        'SELECT b.*,d.hostname FROM "SourceSiteBinding" b JOIN "Domain" d ON d.id=b."defaultDomainId" WHERE b."siteId"=$1',
                        [binding.siteId],
                    )
                ).rows,
                originalSql.rows,
            );
            const current = (
                await sql.query(
                    'SELECT * FROM "ActiveDeployment" WHERE "siteId"=$1',
                    [binding.siteId],
                )
            ).rows[0];
            assert.equal(current.routeRevision, 2);
            assert.equal(current.releaseId, releaseId);
            const restoredState = JSON.parse(
                    fs.readFileSync(path.join(restore, 'routes.json')),
                ),
                archivedState = JSON.parse(
                    fs.readFileSync(path.join(restore, 'saved-routes.json')),
                );
            assert.equal(restoredState.routes.length, 1);
            assert.equal(restoredState.previous.length, 0);
            assert.equal(archivedState.routes.length, 2);
            assert.equal(archivedState.previous.length, 1);
            assert.ok(
                archivedState.previous.some(
                    (r) => r.releaseId === originalReleaseId,
                ),
            );
            assert.deepEqual(
                (
                    await sql.query(
                        'SELECT * FROM "DomainChange" WHERE "siteId"=$1',
                        [binding.siteId],
                    )
                ).rows[0],
                proof.domainRetryBefore,
            );
            assert.equal(
                (
                    await sql.query(
                        'SELECT count(*) FROM "PublishOperation" WHERE "leaseOwner" IS NOT NULL OR "candidateCredentialHash" IS NOT NULL',
                    )
                ).rows[0].count,
                '0',
            );
            proof.checks.push({
                fullDurableArchive: true,
                noArchivedPhysicalServing: true,
                domainRetryAfterPreserved: true,
                sqlDeadLeaseFenced: true,
                priorReleaseArtifactRestored: true,
            });
            proof.restoreMs = Date.now() - restoreStarted;
            assert.ok(proof.restoreMs <= 60 * 60 * 1000);
            assert.ok(
                Date.now() - Date.parse(proof.dataTimestamp) <=
                    24 * 60 * 60 * 1000,
            );
            proof.rpoTargetHours = 24;
            proof.rtoTargetMinutes = 60;
            process.env.SNAPSHOT_STORAGE_PATH = path.join(restore, 'artifacts');
            await context.setMaintenance(false);
            restoredWorker = startWorker(restoredUrl, restore);
            const cmsPort = await freePort();
            report.additionalPorts.restoredCms = cmsPort;
            restoredCms = await startCms(mu.href, restore, cmsPort);
            const cmsResponse = await fetch(
                `http://127.0.0.1:${cmsPort}/api/v4/workspaces`,
                { headers: { authorization: 'Bearer ' + cmsToken } },
            );
            assert.equal(cmsResponse.status, 200);
            assert.ok((await cmsResponse.text()).includes('F2 recovery'));
            await sql.query(
                'UPDATE "DomainChange" SET "retryAfter"=now() WHERE "siteId"=$1',
                [binding.siteId],
            );
            await until(
                async () =>
                    (
                        await sql.query(
                            'SELECT status FROM "DomainChange" WHERE "siteId"=$1',
                            [binding.siteId],
                        )
                    ).rows[0].status === 'succeeded',
                'restored domain retry convergence',
            );
            const updated = structuredClone(snapshot);
            updated.pages[0].content.sectionConfigs[0].data.title =
                'F2 republished home';
            const second = await uploadRelease(updated);
            await publish(second, 2);
            assert.ok(
                (await get(traffic.port(), host)).body
                    .toString()
                    .includes('F2 republished home'),
            );
            await publish(originalReleaseId, 3);
            assert.ok(
                (await get(traffic.port(), host)).body
                    .toString()
                    .includes('F2 original home'),
            );
            proof.checks.push({
                imageBytes: true,
                uploadsBytes: true,
                redirect: true,
                sourceBindings: true,
                defaultDomainId: true,
                requestKeys: true,
                deadProvisioningLeaseFenced: true,
                cmsRestartRead: true,
                republishRevision: 3,
                rollbackRevision: 4,
                domainRetryConverged: true,
            });
            proof.domainRetryBefore = {
                id: proof.domainRetryBefore.id,
                retryAfter: proof.domainRetryBefore.retryAfter,
                status: proof.domainRetryBefore.status,
            };
            proof.physical = {
                oldContainer: oldRoute.containerId,
                newContainer: route.containerId,
                oldPort: oldRoute.port,
                newPort: route.port,
            };
            proof.actualRestoredDatabases = {
                postgres: receipt.postgresDatabase,
                mongo: receipt.mongoDatabase,
            };
        } finally {
            sampling = false;
            await sampler;
            if (restoredCms) await stop(restoredCms);
            if (restoredWorker) await stop(restoredWorker);
            if (sourceCms.exitCode === null && sourceCms.signalCode === null)
                await stop(sourceCms);
            if (
                sourceWorker.exitCode === null &&
                sourceWorker.signalCode === null
            )
                await stop(sourceWorker);
            if (traffic) await traffic.close();
            if (restoredMongo) {
                await restoredMongo.db().dropDatabase();
                await restoredMongo.close();
                proof.cleanup.mongoDropped = true;
            }
            // Capture every container of this owned site, including republish and rollback.
            for (const id of context
                .docker([
                    'ps',
                    '-aq',
                    '--filter',
                    'label=gateway.site-id=' + binding.siteId,
                ])
                .split('\n')
                .filter(Boolean))
                containerIds.add(id);
            try {
                await context.disconnectDatabase();
            } catch {}
            sql = context.reconnectDatabase();
            const receiptPath = path.join(restore, 'restore-private.json');
            if (fs.existsSync(receiptPath)) {
                const receipt = JSON.parse(fs.readFileSync(receiptPath));
                if (!restoredMongo) {
                    const cleanupUri = new URL(context.mongoUrl);
                    cleanupUri.pathname = '/' + receipt.mongoDatabase;
                    const cleanupMongo = new MongoClient(cleanupUri.href);
                    await cleanupMongo.connect();
                    await cleanupMongo.db().dropDatabase();
                    await cleanupMongo.close();
                }
                proof.cleanup.mongoAbsent = !(
                    await mongo
                        .db('admin')
                        .admin()
                        .listDatabases({ nameOnly: true })
                ).databases.some((db) => db.name === receipt.mongoDatabase);
                assert.match(
                    receipt.postgresDatabase,
                    /^platform_restore_[a-f0-9]{24}$/,
                );
                await sql.query(
                    `DROP DATABASE IF EXISTS "${receipt.postgresDatabase}" WITH (FORCE)`,
                );
                proof.cleanup.postgresAbsent =
                    (
                        await sql.query(
                            'SELECT datname FROM pg_database WHERE datname=$1',
                            [receipt.postgresDatabase],
                        )
                    ).rowCount === 0;
            }
            proof.cleanup.sharedServicesRunning = [
                'platform-delivery-a1-20261106-postgres-1',
                'platform-delivery-a1-20261106-mongo-1',
            ].every(
                (name) =>
                    JSON.parse(context.docker(['inspect', name]))[0].State
                        .Running,
            );
        }
    },
});
if (result && !result.assertionsPassed) {
    console.error(result.failure);
    process.exitCode = 1;
} else
    console.log(
        'PASS: source-only independent-directory disaster recovery; private evidence in E2E_RUNTIME_DIR.',
    );
