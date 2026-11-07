import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runOwnedFixture } from './owned-runtime.mjs';
import { validatePlatformLock } from '../release/platform-lock.mjs';
import { acceptanceTemplates } from './acceptance-report.mjs';
import { validateLaunchEnvelope } from './launch-results.mjs';
import { launchFaults } from './launch-faults.mjs';
const checksum = (bytes) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex');

export function verifyArtifactBinding(
    record,
    pinned,
    sourceCommit,
    archiveBytes,
) {
    assert.equal(record.id, pinned.id);
    assert.equal(record.version, pinned.version);
    assert.equal(record.sourceCommit, sourceCommit);
    assert.equal(record.manifestChecksum, pinned.manifestChecksum);
    assert.equal(record.bundleDigest, pinned.previewBundleDigest);
    assert.equal(record.artifactDigest, pinned.previewArtifactDigest);
    assert.equal(
        checksum(archiveBytes),
        pinned.previewArtifactDigest,
        'Actual archive bytes must match lock',
    );
}
export async function verifyServedPreview(origin, record, manifest) {
    const response = await fetch(
        origin + '/api/v1/renderers/' + record.id + '/' + record.version,
        { signal: AbortSignal.timeout(10000) },
    );
    assert.equal(response.status, 200);
    const descriptor = await response.json();
    assert.equal(descriptor.digest, record.bundleDigest);
    assert.equal(
        descriptor.url,
        origin + '/preview/' + record.id + '/' + record.version + '/',
    );
    for (const file of manifest.files) {
        const served = await fetch(new URL(file.path, descriptor.url), {
            signal: AbortSignal.timeout(10000),
        });
        assert.equal(served.status, 200);
        const bytes = Buffer.from(await served.arrayBuffer());
        assert.equal(bytes.length, file.size);
        assert.equal(
            checksum(bytes),
            'sha256:' + file.checksum,
            'Served Preview bytes differ from installed artifact',
        );
    }
    return descriptor;
}

export async function runFormalOwned(env = process.env) {
    const lockBytes = fs.readFileSync(env.E2E_PLATFORM_LOCK),
        lock = validatePlatformLock(JSON.parse(lockBytes));
    const lockChecksum = checksum(lockBytes),
        runId = env.STOREFRONT_E2E_RUN_ID;
    assert.ok(runId, 'Current runner identity required');
    assert.equal(env.STOREFRONT_E2E_LOCK_CHECKSUM, lockChecksum);
    for (const key of [
        'E2E_FORMAL_ARTIFACTS',
        'E2E_FORMAL_TLS_CERT',
        'E2E_FORMAL_TLS_KEY',
        'E2E_FORMAL_PLATFORM_DOMAIN',
        'E2E_PREVIEW_ROOT',
    ])
        assert.ok(env[key], key + ' required');
    assert.ok(/^[a-z0-9.-]+$/.test(env.E2E_FORMAL_PLATFORM_DOMAIN));
    assert.ok(
        !env.PUBLIC_TEMPLATE_REGISTRY_FILE,
        'Formal mode must use verified public registry',
    );
    const supplied = JSON.parse(
        fs.readFileSync(env.E2E_FORMAL_ARTIFACTS, 'utf8'),
    );
    let previewOrigin, registryPath, bundlesRoot;
    const installed = [];
    const report = await runOwnedFixture({
        formal: true,
        platformDomain: env.E2E_FORMAL_PLATFORM_DOMAIN,
        certPath: env.E2E_FORMAL_TLS_CERT,
        keyPath: env.E2E_FORMAL_TLS_KEY,
        async prepare({ report, runRoot, docker }) {
            for (const name of ['cms', 'gateway', 'templates', 'preview']) {
                assert.equal(
                    report.source[name]?.head,
                    lock.repositories[name].commit,
                    'Executed source differs from lock',
                );
                assert.deepEqual(
                    report.source[name].files,
                    [],
                    'Formal source must be clean',
                );
            }
            const buildLog = fs.openSync(
                path.join(runRoot, 'gateway-build.private.log'),
                'w',
                0o600,
            );
            try {
                for (const workspace of [
                    '@gateway/contracts',
                    '@gateway/traffic',
                    '@gateway/worker',
                    '@gateway/ingest',
                ]) {
                    const built = spawnSync(
                        'npm',
                        ['run', 'build', '--workspace', workspace],
                        {
                            cwd: env.E2E_GATEWAY_ROOT,
                            env,
                            stdio: ['ignore', buildLog, buildLog],
                        },
                    );
                    assert.equal(
                        built.status,
                        0,
                        'Current Gateway runtime build',
                    );
                }
            } finally {
                fs.closeSync(buildLog);
            }
            const backend = createRequire(
                path.join(
                    path.dirname(new URL(import.meta.url).pathname),
                    '../../backend/package.json',
                ),
            );
            backend('ts-node').register({
                transpileOnly: true,
                moduleTypes: {
                    [path.join(
                        env.E2E_GATEWAY_ROOT,
                        'packages/contracts/src/**',
                    )]: 'cjs',
                },
                compilerOptions: {
                    module: 'CommonJS',
                    moduleResolution: 'node',
                },
            });
            const { loadPublicTemplate } = backend(
                path.join(
                    env.E2E_GATEWAY_ROOT,
                    'apps/control/src/public-registry.ts',
                ),
            );
            const installer = await import(
                pathToFileURL(
                    path.join(env.E2E_PREVIEW_ROOT, 'ops/install-bundle.mjs'),
                )
            );
            registryPath = path.join(runRoot, 'preview-registry.json');
            bundlesRoot = path.join(runRoot, 'preview-bundles');
            report.artifacts = [];
            report.gatewayBuiltFromLockedSource = true;
            for (const target of acceptanceTemplates) {
                const pinned = lock.templates.find(
                    (t) => t.id === target.id && t.version === target.version,
                );
                assert.ok(pinned);
                const published = await loadPublicTemplate(
                    target.id,
                    target.version,
                );
                for (const key of ['manifestChecksum', 'imageDigest'])
                    assert.equal(published[key], pinned[key]);
                assert.equal(
                    published.sourceCommit,
                    lock.repositories.templates.commit,
                );
                const image =
                    published.imageRepository + '@' + pinned.imageDigest;
                docker(['pull', image]);
                const inspected = JSON.parse(
                    docker(['image', 'inspect', image]),
                )[0];
                assert.ok(
                    inspected.RepoDigests.includes(image),
                    'OCI registry digest must be present',
                );
                assert.equal(
                    inspected.Config.Labels[
                        'org.opencontainers.image.revision'
                    ],
                    published.sourceCommit,
                );
                const artifact = supplied.records.find(
                    (a) =>
                        a.record.id === target.id &&
                        a.record.version === target.version,
                );
                assert.ok(artifact, 'Exact Preview artifact required');
                verifyArtifactBinding(
                    artifact.record,
                    pinned,
                    published.sourceCommit,
                    fs.readFileSync(artifact.archivePath),
                );
                const stagingDir = path.join(
                    runRoot,
                    'preview-stage-' + target.id,
                );
                fs.mkdirSync(stagingDir);
                await installer.extractBundleArchive({
                    archivePath: artifact.archivePath,
                    stagingDir,
                });
                const manifest = await installer.verifyBundle(
                    stagingDir,
                    artifact.record,
                );
                await installer.installBundle({
                    stagingDir,
                    bundlesRoot,
                    registryPath,
                    record: artifact.record,
                });
                installed.push({ record: artifact.record, manifest });
                report.artifacts.push({
                    target,
                    image,
                    previewArtifactDigest: artifact.record.artifactDigest,
                    previewBundleDigest: artifact.record.bundleDigest,
                });
            }
        },
        async configure({
            cmsAddress,
            report,
            runRoot,
            processes,
            freePort,
            until,
        }) {
            const port = await freePort();
            previewOrigin = 'http://127.0.0.1:' + port;
            report.previewPort = port;
            const log = fs.openSync(
                path.join(runRoot, 'preview.private.log'),
                'w',
                0o600,
            );
            processes.spawn(
                process.execPath,
                [path.join(env.E2E_PREVIEW_ROOT, 'src/server.mjs')],
                {
                    cwd: env.E2E_PREVIEW_ROOT,
                    env: {
                        ...env,
                        PREVIEW_HOST: '127.0.0.1',
                        PREVIEW_PORT: String(port),
                        PREVIEW_REGISTRY_PATH: registryPath,
                        PREVIEW_BUNDLES_ROOT: bundlesRoot,
                        PREVIEW_PUBLIC_ORIGIN: previewOrigin,
                        PREVIEW_ADMIN_ORIGIN: cmsAddress,
                    },
                    stdio: ['ignore', log, log],
                },
            );
            fs.closeSync(log);
            await until(async () => {
                try {
                    return (await fetch(previewOrigin + '/health-check')).ok;
                } catch {
                    return false;
                }
            }, 'owned Preview');
            for (const { record, manifest } of installed)
                await verifyServedPreview(previewOrigin, record, manifest);
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
                    cwd: path.join(
                        path.dirname(new URL(import.meta.url).pathname),
                        '../../ui',
                    ),
                    env: {
                        ...env,
                        VITE_TEMPLATE_PREVIEW_ORIGIN: previewOrigin,
                        VITE_TEMPLATE_PREVIEW_RENDERERS: '',
                        VITE_STOREFRONT_ORIGIN: '',
                    },
                    stdio: ['ignore', buildLog, buildLog],
                },
            );
            fs.closeSync(buildLog);
            assert.equal(await processes.exit(build), 0, 'Current UI build');
            return { STOREFRONT_PREVIEW_SERVICE_URL: previewOrigin };
        },
        async execute(runtime) {
            const {
                report,
                runRoot,
                processes,
                cmsRoot,
                cmsAddress,
                browserEmail,
                browserPassword,
                sql,
                mongo,
                cms,
            } = runtime;
            const browserEnv = {
                ...env,
                STOREFRONT_E2E_CMS: cmsAddress,
                STOREFRONT_E2E_EMAIL: browserEmail,
                STOREFRONT_E2E_PASSWORD: browserPassword,
                STOREFRONT_E2E_PRIVATE_DIR: path.join(runRoot, 'private'),
                STOREFRONT_E2E_LAUNCH: '1',
                STOREFRONT_E2E_LAUNCH_LOCAL: '0',
                STOREFRONT_E2E_PREVIEW_ORIGIN: previewOrigin,
            };
            const browser = async (spec, extra, label) => {
                const log = fs.openSync(
                    path.join(runRoot, label + '.private.log'),
                    'w',
                    0o600,
                );
                const child = processes.spawn(
                    process.execPath,
                    [
                        'node_modules/@playwright/test/cli.js',
                        'test',
                        '--config',
                        'ops/e2e/playwright.config.mjs',
                        spec,
                        '--project=desktop',
                    ],
                    {
                        cwd: cmsRoot,
                        env: {
                            ...browserEnv,
                            ...extra,
                            STOREFRONT_E2E_RESULTS_DIR: path.join(
                                runRoot,
                                label,
                            ),
                        },
                        stdio: ['ignore', log, log],
                    },
                );
                fs.closeSync(log);
                const exit = await processes.exit(child);
                assert.equal(
                    exit,
                    0,
                    label + ' must finish including teardown',
                );
                return exit;
            };
            delete browserEnv.STOREFRONT_E2E_WORKSPACE_ID;
            delete browserEnv.STOREFRONT_E2E_SITE_ID;
            report.browserExit = await browser(
                'ops/e2e/launch.spec.mjs',
                {},
                'browser',
            );
            const seeds = [];
            for (const target of acceptanceTemplates) {
                const proof = JSON.parse(
                    fs.readFileSync(
                        path.join(
                            env.STOREFRONT_E2E_LAUNCH_RESULTS,
                            target.id + '.json',
                        ),
                        'utf8',
                    ),
                );
                validateLaunchEnvelope(proof, {
                    runId,
                    lockChecksum,
                    target,
                    scope: 'formal-UI',
                });
                const binding = await mongo
                    .db()
                    .collection('bcms_site_gateway_bindings')
                    .findOne({
                        cmsWorkspaceId: proof.site.cmsWorkspaceId,
                        cmsSiteId: proof.site.cmsSiteId,
                    });
                assert.ok(
                    binding,
                    'UI site must have automatic persisted binding',
                );
                const authority = (
                    await sql.query(
                        'SELECT * FROM "SourceSiteBinding" WHERE "siteId"=$1',
                        [binding.siteId],
                    )
                ).rows[0];
                assert.ok(authority, 'Owned Gateway authority missing');
                assert.equal(authority.instanceId, 'c4-' + runtime.identity);
                assert.equal(authority.cmsSiteId, proof.site.cmsSiteId);
                assert.equal(
                    authority.cmsWorkspaceId,
                    proof.site.cmsWorkspaceId,
                );
                const site = {
                    ...proof.site,
                    siteId: binding.siteId,
                    workspaceId: binding.workspaceId,
                    host: new URL(binding.siteUrl).hostname,
                    mediaId: proof.mediaId,
                    target,
                };
                report.sites.push(site);
                const active = (
                    await sql.query(
                        'SELECT * FROM "ActiveDeployment" WHERE "siteId"=$1',
                        [site.siteId],
                    )
                ).rows[0];
                assert.ok(active);
                const saved = (
                    await sql.query(
                        'SELECT * FROM "Release" WHERE "siteId"=$1 AND "releaseId"=$2',
                        [site.siteId, active.releaseId],
                    )
                ).rows[0];
                assert.ok(saved);
                const snapshot = JSON.parse(
                    fs.readFileSync(saved.snapshotRef, 'utf8'),
                );
                const gateway = async (route, body) => {
                    const response = await fetch(
                        'http://127.0.0.1:' +
                            report.gatewayPort +
                            '/api/v1/sites/' +
                            site.siteId +
                            '/' +
                            route,
                        {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/json',
                                authorization:
                                    'Bearer ' + runtime.serviceSecret,
                                'X-CMS-Workspace': site.cmsWorkspaceId,
                                'X-CMS-Site': site.cmsSiteId,
                            },
                            body: JSON.stringify(body),
                        },
                    );
                    assert.ok(response.ok);
                    return response.json();
                };
                seeds.push({
                    binding,
                    snapshot,
                    metadata: saved.metadata,
                    gateway,
                });
            }
            const publicGet = async (host, url = '/') => {
                const response = await fetch('https://' + host + url, {
                    signal: AbortSignal.timeout(15000),
                });
                const result = {
                    status: response.status,
                    body: await response.text(),
                };
                const owned = await runtime.publicGet(host, url);
                assert.deepEqual(
                    result,
                    { status: owned.status, body: owned.body },
                    'Public DNS/TLS must reach this owned runtime',
                );
                return result;
            };
            report.faults = await launchFaults({
                ...runtime,
                publicGet,
                gatewayPort: report.gatewayPort,
                sites: report.sites,
                seeds,
                formal: true,
            });
            const marker = 'D1 lead ' + runId,
                otherMarker = 'D1 other ' + runId,
                eventPath = '/d1-' + runId,
                otherEventPath = '/d1-other-' + runId;
            for (const [index, site] of report.sites.entries()) {
                const intake = async (route, body) => {
                    const r = await fetch(
                        'http://127.0.0.1:' +
                            report.faults.ingestPort +
                            '/api/v1/sites/' +
                            site.siteId +
                            '/' +
                            route,
                        {
                            method: 'POST',
                            headers: {
                                origin: 'https://' + site.host,
                                'content-type': 'application/json',
                            },
                            body: JSON.stringify(body),
                        },
                    );
                    assert.ok([200, 202].includes(r.status));
                    return r.json();
                };
                const text = index ? otherMarker : marker;
                await intake('leads', {
                    source: 'contact',
                    name: text,
                    email: 'owned@acceptance.invalid',
                    message: text,
                    idempotencyKey: runId,
                });
                const event = {
                    eventId: randomUUID(),
                    path: index ? otherEventPath : eventPath,
                    visitorId: runId,
                };
                assert.equal((await intake('events', event)).duplicate, false);
                assert.equal((await intake('events', event)).duplicate, true);
            }
            const resultDirectory = path.join(runRoot, 'operations-cases');
            fs.mkdirSync(resultDirectory);
            const input = path.join(runRoot, 'operations-input.json');
            fs.writeFileSync(
                input,
                JSON.stringify({
                    runId,
                    lockChecksum,
                    scope: 'formal-operations',
                    resultDirectory,
                    marker,
                    otherMarker,
                    eventPath,
                    otherEventPath,
                    first: report.sites[0],
                    second: report.sites[1],
                }),
            );
            report.operationsBrowserExit = await browser(
                'ops/e2e/launch-operations.spec.mjs',
                { STOREFRONT_E2E_OPERATIONS: input },
                'operations-browser',
            );
            report.cases = [];
            for (const target of acceptanceTemplates) {
                const result = JSON.parse(
                    fs.readFileSync(
                        path.join(resultDirectory, target.id + '.json'),
                        'utf8',
                    ),
                );
                report.cases.push(
                    ...validateLaunchEnvelope(result, {
                        runId,
                        lockChecksum,
                        target,
                        scope: 'formal-operations',
                    }),
                    {
                        id: target.id + '/FAILURE_PRESERVES_ACTIVE',
                        status: 'passed',
                        reason: 'Actual owned candidate and CMS/control/worker/ingest failures; both public sites and authority preserved; processes restored',
                        artifacts: ['owned/faults.json'],
                    },
                );
            }
            // Recheck the live Preview bytes after the browser has used the actual iframe.
            for (const { record, manifest } of installed)
                await verifyServedPreview(previewOrigin, record, manifest);
        },
    });
    report.runId = runId;
    report.lockChecksum = lockChecksum;
    report.scope = 'formal-owned-runtime';
    report.cleanupVerified =
        report.cleanup.sqlAbsent === true &&
        report.cleanup.mongoAbsent === true &&
        report.cleanup.processGroups.length === 0 &&
        report.cleanup.remainingContainers.length === 0 &&
        Object.values(report.cleanup.portsClosed).every(Boolean);
    fs.writeFileSync(
        path.join(report.runRoot, 'evidence.json'),
        JSON.stringify(report, null, 2),
    );
    return report;
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
    try {
        const report = await runFormalOwned();
        if (!report.assertionsPassed || !report.cleanupVerified)
            process.exitCode = 1;
    } catch {
        console.error(
            'Formal owned lifecycle failed; inspect private runtime diagnostics',
        );
        process.exitCode = 1;
    }
}
