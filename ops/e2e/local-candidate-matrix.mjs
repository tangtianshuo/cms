// Explicit disposable local-image proof; this is never public registry acceptance.
import assert from 'node:assert/strict';
import {
    assertCleanupComplete,
    finalizeRuntimeEvidence,
} from './runtime-evidence.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, open, chmod, stat, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { request } from 'node:http';
function publicRequest(pathname, host) {
    return new Promise((resolve, reject) => {
        const req = request(
            `http://127.0.0.1:18090${pathname}`,
            { headers: { host }, timeout: 10000 },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () =>
                    resolve(
                        new Response(Buffer.concat(chunks), {
                            status: response.statusCode,
                            headers: response.headers,
                        }),
                    ),
                );
            },
        );
        req.on('timeout', () =>
            req.destroy(new Error('Public request timeout')),
        );
        req.on('error', reject);
        req.end();
    });
}
import {
    cmsRoot,
    gatewayRoot,
    runtimeDir,
    readEnv,
    workerEnv,
    compose,
} from './runtime.mjs';
import { toContractSnapshot } from '../../backend/dist/release-contract/snapshot.js';
const hash = (bytes) =>
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const docker = (args) =>
    execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description, timeout = 45000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await check()) return;
        await pause(200);
    }
    throw new Error(`Timed out: ${description}`);
}
export async function runLocalCandidateMatrix({ faults = true } = {}) {
    assert.equal(
        process.env.E2E_LOCAL_CANDIDATES,
        '1',
        'Local candidate proof requires explicit E2E_LOCAL_CANDIDATES=1',
    );
    const e = await readEnv();
    const build = JSON.parse(
        await readFile(path.join(runtimeDir, 'build-evidence.json'), 'utf8'),
    );
    const templatesRoot = process.env.E2E_TEMPLATES_ROOT;
    assert.ok(templatesRoot, 'E2E_TEMPLATES_ROOT required');
    const { Pool } = createRequire(path.join(gatewayRoot, 'package.json'))(
        'pg',
    );
    const pool = new Pool({ connectionString: workerEnv(e).DATABASE_URL });
    const report = {
        schemaVersion: 1,
        evidenceType: 'isolated-local-candidate',
        publicRegistryPublication: 'awaiting-B2',
        formalLockAccepted: false,
        startedAt: new Date().toISOString(),
        sourceIdentities: build.repositories,
        services: [],
        cases: [],
    };
    const file = path.join(
        runtimeDir,
        faults ? 'runtime-isolation.json' : 'local-publication.json',
    );
    const sites = [];
    const children = new Set();
    const stopped = new Set();
    let checksPassed = false;
    let worker;
    let networkOwned = false;
    let routeStateOwned = false;
    async function processStart(kind, imageDigest = '') {
        const log = await open(
            path.join(runtimeDir, `${kind}-matrix.log`),
            'a',
        );
        const child = spawn(
            process.execPath,
            [path.join(gatewayRoot, `packages/${kind}/dist/index.js`)],
            {
                cwd: gatewayRoot,
                env: {
                    ...workerEnv(e),
                    GATEWAY_APPROVED_IMAGE_DIGEST: imageDigest,
                },
                stdio: ['ignore', log.fd, log.fd],
            },
        );
        await log.close();
        children.add(child);
        report.services.push({
            kind,
            pid: child.pid,
            entrypoint: `packages/${kind}/dist/index.js`,
            imageDigest: imageDigest || undefined,
        });
        child.done = new Promise((resolve) =>
            child.once('exit', (code, signal) => {
                child.result = { code, signal };
                resolve();
            }),
        );
        return child;
    }
    async function processStop(child) {
        if (!child || child.result) return;
        child.kill('SIGTERM');
        await until(async () => !!child.result, `${child.pid} exits`);
        children.delete(child);
    }
    async function serviceId(name) {
        const id = docker([
            'ps',
            '-aq',
            '--filter',
            `label=com.docker.compose.project=${e.COMPOSE_PROJECT_NAME}`,
            '--filter',
            `label=com.docker.compose.service=${name}`,
        ]);
        assert.match(id, /^[a-f0-9]{12,64}$/);
        return id;
    }
    async function serviceStop(name) {
        const id = await serviceId(name);
        compose('stop', name);
        stopped.add(name);
        const info = JSON.parse(docker(['inspect', id]))[0];
        assert.equal(info.State.Running, false);
        return {
            service: name,
            id: info.Id,
            running: info.State.Running,
            finishedAt: info.State.FinishedAt,
        };
    }
    async function serviceStart(name) {
        compose('start', name);
        const probes = {
            cms: ['http://127.0.0.1:18080/api/v4/health-check', 200],
            'gateway-control': [
                'http://127.0.0.1:18183/api/v1/sites/unknown',
                401,
            ],
            'gateway-ingest': ['http://127.0.0.1:18184/healthz', 404],
        };
        const probe = probes[name];
        await until(async () => {
            try {
                return (
                    (
                        await fetch(probe[0], {
                            method: name === 'cms' ? 'HEAD' : 'GET',
                            signal: AbortSignal.timeout(2000),
                        })
                    ).status === probe[1]
                );
            } catch {
                return false;
            }
        }, `${name} restoration`);
        stopped.delete(name);
    }
    async function api(siteId, route, body, status) {
        const response = await fetch(
            `http://127.0.0.1:18183/api/v1/sites/${siteId}/${route}`,
            {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    authorization: `Bearer ${e.E2E_SERVICE_SECRET}`,
                    'content-type': 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(10000),
            },
        );
        const json = await response.json();
        assert.equal(
            response.status,
            status ?? (body === undefined ? 200 : 201),
            JSON.stringify(json),
        );
        return json;
    }
    async function state(site) {
        return (
            await pool.query(
                'SELECT "releaseId", "imageDigest", "routeRevision" FROM "ActiveDeployment" WHERE "siteId"=$1',
                [site],
            )
        ).rows[0];
    }
    async function route(site) {
        return JSON.parse(
            await readFile(
                path.join(runtimeDir, 'gateway-routes.json'),
                'utf8',
            ),
        ).routes.find((r) => r.siteId === site);
    }
    async function pages(host) {
        const result = [];
        for (const [url, expected] of [
            ['/', 200],
            ['/catalog', 200],
            ['/product', 200],
            ['/company', 200],
            ['/_assets/media/proof/original.txt', 200],
            ['/old-catalog', 308],
            ['/sitemap.xml', 200],
        ]) {
            const response = await publicRequest(url, host);
            const body = Buffer.from(await response.arrayBuffer());
            assert.equal(response.status, expected, `${host}${url}`);
            if (url === '/old-catalog')
                assert.equal(response.headers.get('location'), '/catalog');
            if (url.includes('proof'))
                assert.equal(body.toString(), 'immutable A4 media');
            if (url === '/sitemap.xml') {
                assert.match(response.headers.get('content-type'), /xml/);
                assert.ok(body.toString().includes('/product'));
            }
            result.push({
                path: url,
                status: response.status,
                checksum: hash(body),
                location: response.headers.get('location'),
            });
        }
        return result;
    }
    async function intake(siteId, host) {
        const eventId = randomUUID();
        const response = await fetch(
            `http://127.0.0.1:18184/api/v1/sites/${siteId}/events`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    origin: `https://${host}`,
                },
                body: JSON.stringify({
                    eventId,
                    path: '/',
                    eventType: 'page_view',
                }),
            },
        );
        assert.equal(response.status, 202, await response.text());
        const count = await pool.query(
            'SELECT count(*)::int AS n FROM "AnalyticsEvent" WHERE "siteId"=$1 AND "eventId"=$2',
            [siteId, eventId],
        );
        assert.equal(count.rows[0].n, 1);
    }
    try {
        for (const name of [
            'cms',
            'gateway-control',
            'gateway-ingest',
            'gateway-tls',
        ]) {
            const info = JSON.parse(
                docker(['inspect', await serviceId(name)]),
            )[0];
            assert.equal(info.State.Running, true);
            assert.equal(
                info.Config.Labels['com.docker.compose.project'],
                e.COMPOSE_PROJECT_NAME,
            );
            if (name === 'cms')
                assert.equal(info.Image, build.images.cms.imageId);
            if (name === 'gateway-control' || name === 'gateway-ingest')
                assert.equal(info.Image, build.images.gateway.imageId);
            report.services.push({
                kind: name,
                id: info.Id,
                imageId: info.Image,
                networkMode: info.HostConfig.NetworkMode,
                sandboxId: info.NetworkSettings.SandboxID,
            });
        }
        assert.notEqual(
            report.services[0].sandboxId,
            report.services[1].sandboxId,
            'CMS/control must have independent namespaces',
        );
        // Real CMS Node verifies this fixture certificate using its explicit extra CA.
        const tls = docker([
            'exec',
            await serviceId('cms'),
            'node',
            '-e',
            "fetch('https://gateway-tls/api/v1/sites/unknown').then(r=>{if(r.status!==401)process.exit(1);console.log('verified TLS, unauthorized without credentials')}).catch(()=>process.exit(1))",
        ]);
        report.cases.push({
            id: 'cms-to-control-verified-tls',
            status: 'passed',
            reason: tls,
        });
        try {
            docker(['network', 'inspect', 'gateway-sites']);
        } catch {
            docker(['network', 'create', 'gateway-sites']);
            networkOwned = true;
        }
        await writeFile(
            path.join(runtimeDir, 'gateway-routes.json'),
            JSON.stringify({ routes: [], previous: [] }),
            { mode: 0o600, flag: 'wx' },
        );
        routeStateOwned = true;
        const traffic = await processStart('traffic');
        await until(async () => {
            try {
                if (traffic.result)
                    throw new Error('Owned traffic exited before readiness');
                return (
                    !traffic.result &&
                    (await fetch('http://127.0.0.1:18090/healthz')).ok
                );
            } catch {
                return false;
            }
        }, 'independent traffic starts');
        await pool.query(
            'INSERT INTO "Workspace" (id,name,"updatedAt") VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING',
            [e.E2E_GATEWAY_WORKSPACE, 'A4 local image acceptance'],
        );
        for (const template of JSON.parse(e.E2E_TEMPLATES)) {
            const identity = `${template.id}@${template.version}`;
            const image = build.images[`${template.id}-${template.version}`];
            assert.ok(image?.imageId);
            assert.equal(
                docker([
                    'image',
                    'inspect',
                    template.image,
                    '--format',
                    '{{.Id}}',
                ]),
                image.imageId,
            );
            const siteId = randomUUID();
            sites.push(siteId);
            const host = `${template.id}-${siteId.slice(0, 8)}.a4.localhost`;
            await pool.query(
                'INSERT INTO "Site" (id,"workspaceId","updatedAt") VALUES ($1,$2,NOW())',
                [siteId, e.E2E_GATEWAY_WORKSPACE],
            );
            await pool.query(
                'INSERT INTO "Domain" (id,"siteId",hostname,status,"ownershipStatus","dnsStatus","certificateStatus","isPrimary","updatedAt") VALUES (gen_random_uuid(),$1,$2,\'active\',\'verified\',\'ready\',\'ready\',true,NOW())',
                [siteId, host],
            );
            await pool.query(
                'INSERT INTO "TemplatePin" (id,"siteId","templateId",version,"imageDigest","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,$4,NOW())',
                [siteId, template.id, template.version, image.imageId],
            );
            const manifest = JSON.parse(
                await readFile(
                    path.join(
                        templatesRoot,
                        'templates',
                        template.id,
                        template.version,
                        'template.json',
                    ),
                    'utf8',
                ),
            );
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
            const manifestChecksum = hash(JSON.stringify(canonical(manifest)));
            const preset = {
                id: template.id,
                version: template.version,
                name: manifest.name,
                description: manifest.description,
                ...manifest.presentation,
            };
            const page = (url, view, sections) => ({
                path: url,
                pageKey: view,
                entryId: `${view}-entry`,
                content: {
                    kind: 'preset-page',
                    view,
                    preset,
                    sections,
                    seo: { title: `${identity} ${view}`, description: '' },
                    items: [],
                },
            });
            const snapshot = toContractSnapshot({
                schemaVersion: 1,
                workspaceId: e.E2E_GATEWAY_WORKSPACE,
                siteId,
                language: 'en',
                pages: [
                    page('/', 'home', ['hero']),
                    page('/catalog', 'collection', ['heading', 'grid']),
                    page('/product', 'product', [
                        'information',
                        'description',
                        'gallery',
                    ]),
                    page('/company', 'page', ['story']),
                ],
                navigation: [
                    {
                        id: 'catalog',
                        label: 'Catalog',
                        href: '/catalog',
                        children: [],
                        enabled: true,
                    },
                ],
                redirects: [{ from: '/old-catalog', to: '/catalog' }],
                operations: {
                    seoTitle: identity,
                    seoDescription: '',
                    contactFormEnabled: true,
                },
            });
            const bytes = Buffer.from('immutable A4 media');
            snapshot.assets = [
                {
                    path: 'media/proof/original.txt',
                    mimeType: 'text/plain',
                    checksum: hash(bytes),
                    contentBase64: bytes.toString('base64'),
                },
            ];
            const upload = async (value) => {
                const releaseId = randomUUID(),
                    bytes = Buffer.from(JSON.stringify(value));
                await api(siteId, 'releases', {
                    siteId,
                    releaseId,
                    checksum: hash(bytes),
                    metadata: {
                        templateId: template.id,
                        templateVersion: template.version,
                        imageDigest: image.imageId,
                        manifestChecksum,
                    },
                    snapshot: bytes.toString('base64'),
                });
                return releaseId;
            };
            const publish = async (releaseId) => {
                const expectedRevision = (
                    await pool.query(
                        'SELECT "desiredRevision" FROM "Site" WHERE id=$1',
                        [siteId],
                    )
                ).rows[0].desiredRevision;
                const body = {
                    releaseId,
                    expectedRevision,
                    idempotencyKey: randomUUID(),
                };
                const operation = await api(siteId, 'publish-operations', body);
                assert.equal(
                    (await api(siteId, 'publish-operations', body, 200)).id,
                    operation.id,
                );
                await api(
                    siteId,
                    'publish-operations',
                    { ...body, idempotencyKey: randomUUID() },
                    409,
                );
                return operation;
            };
            const outcome = async (op, expected = 'ready') => {
                let result;
                await until(
                    async () => {
                        if (worker?.result)
                            throw new Error(
                                `Worker exited: ${JSON.stringify(worker.result)}`,
                            );
                        result = await api(
                            siteId,
                            `publish-operations/${op.id}`,
                        );
                        return ['ready', 'failed'].includes(result.status);
                    },
                    `${identity} operation completes`,
                    90000,
                );
                assert.equal(result.status, expected, JSON.stringify(result));
                return result;
            };
            worker = await processStart('worker', image.imageId);
            const initialRelease = await upload(snapshot);
            const initialOp = await publish(initialRelease);
            await outcome(initialOp);
            const baseline = await pages(host);
            if (!faults) {
                const draft = structuredClone(snapshot);
                const title = `Local candidate draft ${randomUUID()}`;
                draft.pages[0].content.sectionConfigs = [
                    { type: 'hero', enabled: true, data: { title } },
                ];
                const draftRelease = await upload(draft);
                assert.deepEqual(
                    await pages(host),
                    baseline,
                    'uploading an unpublished snapshot cannot change public output',
                );
                await outcome(await publish(draftRelease));
                assert.ok(
                    (await (await publicRequest('/', host)).text()).includes(
                        title,
                    ),
                );
                await outcome(await publish(initialRelease));
                assert.deepEqual(
                    await pages(host),
                    baseline,
                    'rollback must restore original immutable public output',
                );
                report.cases.push({
                    id: `${identity}:draft-isolation-publish-rollback`,
                    status: 'passed',
                    originalReleaseId: initialRelease,
                    draftReleaseId: draftRelease,
                });
            }
            const active = await state(siteId),
                routing = await route(siteId);
            const info = JSON.parse(
                docker(['inspect', routing.containerId]),
            )[0];
            assert.equal(info.Config.Image, active.imageDigest);
            assert.equal(info.Image, image.imageId);
            const mount = info.Mounts.find(
                (m) =>
                    m.Destination ===
                    '/var/lib/gateway/artifacts/published.json',
            );
            assert.equal(mount.RW, false);
            assert.equal((await stat(mount.Source)).mode & 0o777, 0o444);
            assert.equal(
                (await stat(path.dirname(mount.Source))).mode & 0o777,
                0o700,
            );
            report.services.push({
                kind: identity,
                siteId,
                containerId: info.Id,
                imageId: info.Image,
                configuredImage: info.Config.Image,
                authoritativeImage: active.imageDigest,
                networkMode: info.HostConfig.NetworkMode,
                artifact: {
                    source: mount.Source,
                    readOnly: !mount.RW,
                    mode: '0444',
                    parentMode: '0700',
                },
                active,
            });
            report.cases.push({
                id: `${identity}:real-local-publish-idempotency-stale-rejection`,
                status: 'passed',
                baseline,
            });
            if (faults) {
                for (const name of [
                    'cms',
                    'gateway-control',
                    'worker',
                    'gateway-ingest',
                ]) {
                    let fault;
                    try {
                        if (name === 'worker') {
                            const pid = worker.pid;
                            await processStop(worker);
                            fault = { pid, exited: worker.result };
                            worker = undefined;
                        } else fault = await serviceStop(name);
                        assert.deepEqual(await pages(host), baseline);
                        assert.deepEqual(await state(siteId), active);
                        assert.equal(
                            hash(JSON.stringify(await route(siteId))),
                            hash(JSON.stringify(routing)),
                            'route snapshot changed',
                        );
                        if (name !== 'gateway-ingest')
                            await intake(siteId, host);
                        report.cases.push({
                            id: `${identity}:${name}-stopped`,
                            status: 'passed',
                            fault,
                            samePublicResponses: true,
                            activeUnchanged: true,
                            routeUnchanged: true,
                        });
                    } finally {
                        if (name === 'worker' && !worker)
                            worker = await processStart(
                                'worker',
                                image.imageId,
                            );
                        else if (stopped.has(name)) await serviceStart(name);
                    }
                }
            } else {
                // Corrupt only a new unpublished artifact. Active bytes are never modified.
                await processStop(worker);
                worker = undefined;
                const candidate = await upload(snapshot);
                const stored = (
                    await pool.query(
                        'SELECT "snapshotRef" FROM "Release" WHERE "siteId"=$1 AND "releaseId"=$2',
                        [siteId, candidate],
                    )
                ).rows[0].snapshotRef;
                const file = path.join(
                    e.E2E_SNAPSHOT_HOST_DIR,
                    path.basename(stored),
                );
                assert.notEqual(file, mount.Source);
                const original = await readFile(file);
                try {
                    await chmod(file, 0o600);
                    await writeFile(file, 'corrupt candidate bytes');
                    await chmod(file, 0o444);
                    const op = await publish(candidate);
                    worker = await processStart('worker', image.imageId);
                    const failed = await outcome(op, 'failed');
                    assert.deepEqual(await state(siteId), active);
                    assert.equal(
                        hash(JSON.stringify(await route(siteId))),
                        hash(JSON.stringify(routing)),
                        'route snapshot changed',
                    );
                    assert.deepEqual(await pages(host), baseline);
                    report.cases.push({
                        id: `${identity}:artifact-integrity-failure`,
                        status: 'passed',
                        failureCode: failed.failureCode,
                        activeUnchanged: true,
                        routeUnchanged: true,
                        candidateReleaseId: candidate,
                    });
                } finally {
                    await chmod(file, 0o600);
                    await writeFile(file, original);
                    await chmod(file, 0o444);
                }
                await processStop(worker);
                worker = await processStart('worker', image.imageId);
                assert.deepEqual(await pages(host), baseline);
                assert.deepEqual(await state(siteId), active);
                report.cases.push({
                    id: `${identity}:worker-restart-recovery`,
                    status: 'passed',
                });
            }
            await processStop(worker);
            worker = undefined;
        }
        checksPassed = true;
    } catch (error) {
        report.passed = false;
        report.error = error.message;
        throw error;
    } finally {
        const cleanupErrors = [];
        for (const child of children)
            try {
                await processStop(child);
            } catch (error) {
                cleanupErrors.push(error.message);
            }
        for (const name of stopped)
            try {
                await serviceStart(name);
            } catch (error) {
                cleanupErrors.push(error.message);
            }
        for (const site of sites) {
            try {
                const ids = docker([
                    'ps',
                    '-aq',
                    '--filter',
                    `label=gateway.site-id=${site}`,
                ])
                    .split('\n')
                    .filter(Boolean);
                if (ids.length) docker(['rm', '-f', ...ids]);
            } catch (error) {
                cleanupErrors.push(error.message);
            }
        }
        if (networkOwned)
            try {
                docker(['network', 'rm', 'gateway-sites']);
            } catch (error) {
                cleanupErrors.push(error.message);
            }
        for (const site of sites) {
            try {
                for (const table of [
                    'Deployment',
                    'ActiveDeployment',
                    'PublishOperation',
                    'Publication',
                    'Lead',
                    'AnalyticsEvent',
                    'ReleaseArtifact',
                    'Release',
                    'TemplatePin',
                    'Domain',
                ])
                    await pool.query(
                        `DELETE FROM "${table}" WHERE "siteId"=$1`,
                        [site],
                    );
                await pool.query('DELETE FROM "Site" WHERE id=$1', [site]);
            } catch (error) {
                cleanupErrors.push(`site cleanup: ${error.message}`);
            }
        }
        try {
            await pool.end();
        } catch (error) {
            cleanupErrors.push(`database disconnect: ${error.message}`);
        }
        if (routeStateOwned)
            try {
                await rm(path.join(runtimeDir, 'gateway-routes.json'), {
                    force: true,
                });
            } catch (error) {
                cleanupErrors.push(`route cleanup: ${error.message}`);
            }
        report.cleanup = {
            childProcessesRemaining: [...children]
                .filter((c) => !c.result)
                .map((c) => c.pid),
            servicesStopped: [...stopped],
            errors: cleanupErrors,
        };
        Object.assign(
            report,
            finalizeRuntimeEvidence(report, checksPassed, report.cleanup),
        );
        await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
        assertCleanupComplete(report.cleanup);
    }
    console.log(
        `${faults ? 'runtime-isolation' : 'local-publication'}: PASS (explicit local candidates; public registry acceptance awaiting B2)`,
    );
    return report;
}
