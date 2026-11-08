import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import Fastify, {
    type FastifyError,
    type FastifyReply,
    type FastifyRequest,
} from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { PresetController } from '../presets/controller';
import { RP } from '../security/route-protection/main';
import { verifiedWorkspace, runWithWorkspace } from '../workspaces/context';
import { getPreset } from '../presets/catalog';
import { canonicalJson } from '../presets/registry';
import { releaseSource } from '../presets/release-source';
import type { ReleaseInput } from '../presets/releases';
import type { SiteInstallation } from '../presets/site-model';
import type { Template } from '../template/models/main';
import type { Entry } from '../entry/models/main';
import type { GatewayState } from '../presets/gateway-state';
import {
    configureMigrationService,
    MigrationService,
    migrationSourceChecksum,
} from '../template-contract/migration-service';
import { createMigrationReleaseSource } from '../template-contract/migration-source';
import {
    initMigrationRepository,
    mongoMigrationRepository,
    type MigrationOperation,
} from '../template-contract/migration-repo';
import { setSiteMutationStore } from '../template-contract/site-mutation';
import { mediaAuthorizedForSite } from '../storefront/section-schema';

const runFile = promisify(execFile);
const sha = (value: Buffer | string) =>
    `sha256:${createHash('sha256').update(value).digest('hex')}`;

function recordFor(preset: NonNullable<ReturnType<typeof getPreset>>) {
    return {
        schemaVersion: 1,
        id: preset.id,
        version: preset.version,
        manifestChecksum: sha(
            canonicalJson(JSON.parse(JSON.stringify(preset)) as unknown),
        ),
        imageRepository: `ghcr.io/tangtianshuo/independent-website-templates/${preset.id}`,
        imageDigest: `sha256:${'c'.repeat(64)}`,
        sourceCommit: 'd'.repeat(40),
        manifestPath: `templates/${preset.id}/${preset.version}/template.json`,
        status: 'available',
    };
}

function releaseInput(): ReleaseInput {
    const preset = getPreset('atelier');
    if (!preset) throw new Error('Atelier fixture is unavailable');
    const values: Record<string, Record<string, unknown[]>> = {
        home: {
            title: ['Home'],
            slug: ['home'],
            headline: ['Legacy headline'],
        },
        product: { title: ['Bag'], slug: ['bag'], price: [45] },
        collection: {
            title: ['Shop'],
            slug: ['shop'],
            products: [{ tid: 'product', eid: 'product-entry' }],
        },
        'content-page': {
            title: ['About'],
            slug: ['about'],
            summary: ['Story'],
        },
        'site-settings': {
            title: ['Settings'],
            slug: ['settings'],
            brandName: ['Legacy brand'],
            navigationPages: [
                { tid: 'content-page', eid: 'content-page-entry' },
            ],
        },
    };
    const site: SiteInstallation = {
        _id: randomUUID(),
        workspaceId: 'default',
        contentGroupId: `legacy-group-${randomUUID()}`,
        templateNamespace: `legacy-${randomUUID()}`,
        runtimeMode: 'legacy',
        slot: 'default',
        createdAt: 1,
        updatedAt: 1,
        name: 'Legacy lifecycle',
        presetId: preset.id,
        presetVersion: preset.version,
        presetManifestSnapshot: JSON.stringify(preset),
        publishedTemplateRecord: JSON.stringify(recordFor(preset)),
        gatewayCurrentReleaseId: 'release-old',
        gatewayPublishedReleaseIds: ['release-old'],
        gatewayActiveRevision: 1,
        status: 'ready',
        importError: '',
        includeDemo: false,
        demoSeeded: false,
        theme: { ...preset.theme },
        models: preset.models.map((model) => ({
            key: model.key,
            templateId: model.key,
            fields: model.fields.map((field) => ({
                key: field.key,
                propId: field.key,
            })),
        })),
        pages: preset.pages.map((page) => {
            const types: Record<string, string[]> = {
                home: ['hero-carousel'],
                collections: ['info-grid'],
                product: [
                    'product-gallery',
                    'product-information',
                    'product-description',
                ],
                content: ['info-grid'],
            };
            return {
                ...page,
                status: 'draft',
                sectionConfigs: types[page.key].map((type) => ({
                    type: type as never,
                    enabled: false,
                    data: {},
                })),
            };
        }),
    };
    return {
        site,
        templates: preset.models.map(
            (model) =>
                ({
                    _id: model.key,
                    createdAt: 1,
                    updatedAt: 1,
                    workspaceId: 'default',
                    siteId: site._id,
                    name: model.key,
                    label: model.label,
                    desc: model.description,
                    userId: '__preset',
                    singleEntry: model.singleEntry,
                    props: model.fields.map((field) => ({
                        id: field.key,
                        name: field.key,
                        label: field.label,
                        type: field.type,
                        required: field.required,
                        array: field.array,
                        data: {},
                    })),
                }) as Template,
        ),
        entries: preset.models.map(
            (model) =>
                ({
                    _id: `${model.key}-entry`,
                    createdAt: 1,
                    updatedAt: 1,
                    workspaceId: 'default',
                    siteId: site._id,
                    templateId: model.key,
                    userId: '__preset',
                    groupId: site.contentGroupId,
                    statuses: [],
                    meta: [
                        {
                            lng: 'en',
                            props: Object.entries(values[model.key]).map(
                                ([id, data]) => ({ id, data }),
                            ),
                        },
                    ],
                    content: [],
                }) as unknown as Entry,
        ),
        media: [],
        language: 'en',
        mediaOrigin: 'https://cms.test',
        currency: 'USD',
    };
}

test(
    'CLI, controller, Mongo, worker boundary and runtime complete a per-site legacy migration lifecycle',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 120_000,
    },
    async (context) => {
        const mongo = Fastify();
        await mongo.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_lifecycle_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        context.after(async () => {
            await mongo.mongo.db?.dropDatabase();
            await mongo.close();
        });

        for (const repo of [
            Repo.siteInstallation,
            Repo.template,
            Repo.entry,
            Repo.entryGroup,
            Repo.media,
        ]) {
            await new Promise<void>((resolve, reject) =>
                repo.init().initialize({
                    fastify: mongo,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
            );
        }
        await initMigrationRepository(mongo);
        setSiteMutationStore(Repo.siteInstallation.methods);

        const input = releaseInput();
        const siteId = input.site._id;
        await runWithWorkspace(
            {
                workspaceId: 'default',
                siteId,
                actorId: 'admin',
                admin: true,
                instanceAdmin: true,
                role: 'admin',
            },
            async () => {
                await Repo.siteInstallation.add(input.site);
                await Repo.entryGroup.methods.ensure(
                    input.site.contentGroupId!,
                    siteId,
                    'Legacy content',
                );
                for (const template of input.templates)
                    await Repo.template.add(template, true);
                await mongo.mongo
                    .db!.collection(Repo.entry.collection)
                    .insertMany(input.entries as never);
            },
        );

        const artifactRoot = await mkdtemp(
            join(tmpdir(), 'legacy-lifecycle-artifact-'),
        );
        context.after(() => rm(artifactRoot, { recursive: true, force: true }));
        let activeRelease = 'release-old';
        let activeRevision = 1;
        let currentArtifact: { releaseId: string; marker: string } | null =
            null;
        const gatewayWorker = createServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
                : {};
            response.setHeader('content-type', 'application/json');
            if (request.url === '/publish') {
                activeRelease = `release-${randomUUID()}`;
                activeRevision += 1;
                currentArtifact = {
                    releaseId: activeRelease,
                    marker: 'artifact-current',
                };
                response.end(
                    JSON.stringify({
                        releaseId: activeRelease,
                        routeRevision: activeRevision,
                    }),
                );
                return;
            }
            if (request.url === '/rollback') {
                activeRelease = String(body.releaseId);
                activeRevision = Number(body.routeRevision);
                currentArtifact = {
                    releaseId: activeRelease,
                    marker: 'artifact-restored',
                };
                response.end(
                    JSON.stringify({
                        releaseId: activeRelease,
                        routeRevision: activeRevision,
                    }),
                );
                return;
            }
            if (request.url?.startsWith('/state/')) {
                response.end(
                    JSON.stringify({
                        revision: activeRevision,
                        active: {
                            releaseId: activeRelease,
                            routeRevision: activeRevision,
                            imageDigest: recordFor(getPreset('atelier')!)
                                .imageDigest,
                            metadata: {},
                            snapshot: {
                                schemaVersion: 1,
                                siteId,
                                language: 'en',
                                pages: [],
                                navigation: [],
                                redirects: [],
                            },
                            createdAt: new Date().toISOString(),
                        },
                    }),
                );
                return;
            }
            response.statusCode = 404;
            response.end('{}');
        });
        await new Promise<void>((resolve) =>
            gatewayWorker.listen(0, '127.0.0.1', resolve),
        );
        context.after(
            () =>
                new Promise<void>((resolve) => {
                    gatewayWorker.closeAllConnections?.();
                    gatewayWorker.close(() => resolve());
                }),
        );
        const gatewayAddress = gatewayWorker.address();
        assert.ok(gatewayAddress && typeof gatewayAddress !== 'string');

        const worker = async (
            path: string,
            value?: unknown,
        ): Promise<unknown> => {
            const response = await fetch(
                `http://127.0.0.1:${gatewayAddress.port}${path}`,
                {
                    method: value === undefined ? 'GET' : 'POST',
                    headers: { 'content-type': 'application/json' },
                    ...(value === undefined
                        ? {}
                        : { body: JSON.stringify(value) }),
                },
            );
            assert.equal(response.status, 200);
            return response.json();
        };

        const repository = mongoMigrationRepository();
        const service = new MigrationService({
            repository,
            findSite: (id) => Repo.siteInstallation.methods.findFresh(id),
            async sourceChecksum(operation) {
                const site = await Repo.siteInstallation.methods.findFresh(
                    operation.cmsSiteId,
                );
                assert.ok(site);
                const content = await releaseSource().loadContent(site);
                return migrationSourceChecksum(
                    site,
                    content.templates,
                    content.entries,
                    content.media.filter((item) =>
                        mediaAuthorizedForSite(item, site),
                    ),
                );
            },
            source: (operation) =>
                createMigrationReleaseSource(operation, {
                    base: releaseSource(),
                    update: (value: MigrationOperation) =>
                        repository.save(value),
                }),
            async persistCandidate(operation) {
                await Repo.entryGroup.methods.ensure(
                    operation.candidateSite.contentGroupId!,
                    siteId,
                    'Candidate content',
                );
                for (const template of operation.candidateTemplates || []) {
                    if (!(await Repo.template.findById(template._id)))
                        await Repo.template.add(template, true);
                }
                for (const entry of operation.candidateEntries || []) {
                    if (!(await Repo.entry.findById(entry._id)))
                        await Repo.entry.add(entry, true);
                }
            },
            finalize: (operation, expected) =>
                Repo.siteInstallation.methods.finalizeMigration(
                    operation.cmsSiteId,
                    operation.id,
                    expected,
                    operation.candidateSite,
                ),
            restore: (operation, expected, previous) =>
                Repo.siteInstallation.methods.restoreMigrationSite(
                    operation.cmsSiteId,
                    operation.id,
                    expected,
                    previous,
                ),
            settle: (operation, status) =>
                Repo.siteInstallation.methods.settleMigrationState(
                    operation.cmsSiteId,
                    operation.id,
                    status,
                ),
            gateway: {
                async publish(_source, operation) {
                    const result = (await worker('/publish', {
                        operationId: operation.id,
                    })) as { releaseId: string; routeRevision: number };
                    const latest = (await repository.find(operation.id))!;
                    await repository.save({
                        ...latest,
                        candidateSite: {
                            ...latest.candidateSite,
                            gatewayCurrentReleaseId: result.releaseId,
                            gatewayPublishedReleaseIds: [
                                ...(latest.candidateSite
                                    .gatewayPublishedReleaseIds || []),
                                result.releaseId,
                            ],
                            gatewayActiveRevision: result.routeRevision,
                        },
                    });
                    return {
                        state: (await worker(
                            `/state/${siteId}`,
                        )) as GatewayState,
                        targetReleaseId: result.releaseId,
                        targetRouteRevision: result.routeRevision,
                    };
                },
                readState: async () =>
                    (await worker(`/state/${siteId}`)) as GatewayState,
                async rollback(_source, operation) {
                    await worker('/rollback', {
                        releaseId: operation.previousReleaseId,
                        routeRevision: operation.previousRouteRevision,
                    });
                    return (await worker(`/state/${siteId}`)) as GatewayState;
                },
            },
        });
        configureMigrationService(service);

        const mutableProtection = RP as unknown as Record<string, unknown>;
        const originalProtection = mutableProtection.createWorkspaceAdminCheck;
        mutableProtection.createWorkspaceAdminCheck = () => async () => ({
            token: { payload: { userId: 'admin' } },
            [verifiedWorkspace]: {
                workspaceId: 'default',
                siteId,
                actorId: 'admin',
                admin: true,
                instanceAdmin: true,
                role: 'admin',
            },
        });
        context.after(() => {
            mutableProtection.createWorkspaceAdminCheck = originalProtection;
        });

        let api: ReturnType<typeof Fastify> | undefined;
        async function startApi(): Promise<string> {
            api = Fastify();
            api.setErrorHandler(
                (
                    error: FastifyError,
                    _request: FastifyRequest,
                    reply: FastifyReply,
                ) => {
                    const controlled = error as {
                        status?: number;
                        message?: unknown;
                    };
                    return reply
                        .code(controlled.status || 500)
                        .send(
                            controlled.message &&
                                typeof controlled.message === 'object'
                                ? controlled.message
                                : { message: error.message },
                        );
                },
            );
            const controller = await PresetController({
                config: {},
                fastify: api,
            } as never);
            const methods = await controller.methods(controller);
            for (const name of [
                'legacyMigrationPlan',
                'legacyMigrationApply',
                'migrationStatus',
                'migrationRollback',
            ]) {
                const method = methods.find((item) => item.name === name);
                assert.ok(method, name);
                api.route({
                    method: method.type.toUpperCase() as 'GET' | 'POST',
                    url: `/api/v4/presets${method.path}`,
                    handler: method.handler,
                });
            }
            const address = await api.listen({
                host: '127.0.0.1',
                port: 0,
            });
            return address;
        }
        async function stopApi(): Promise<void> {
            await api?.close();
            api = undefined;
        }
        context.after(stopApi);
        async function cli(
            args: string[],
            base: string,
            stateDirectory?: string,
        ) {
            const result = await runFile(
                process.execPath,
                ['ops/migrate-site.mjs', ...args],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        CMS_ADMIN_TOKEN: 'admin',
                        CMS_MIGRATION_API_BASE: `${base}/api/v4/presets`,
                        ...(stateDirectory
                            ? { CMS_MIGRATION_STATE_DIR: stateDirectory }
                            : {}),
                    },
                },
            );
            return JSON.parse(result.stdout);
        }

        const stateDirectory = await mkdtemp(
            join(tmpdir(), 'legacy-lifecycle-state-'),
        );
        context.after(() =>
            rm(stateDirectory, { recursive: true, force: true }),
        );
        let base = await startApi();
        const planned = await cli(
            ['plan', '--site', siteId, '--request-key', randomUUID()],
            base,
            stateDirectory,
        );
        assert.equal(planned.status, 'staged');
        const adopted = await cli(
            ['apply', '--site', siteId, '--operation', planned.operationId],
            base,
        );
        assert.equal(adopted.status, 'active');
        const migrated = await Repo.siteInstallation.methods.findFresh(siteId);
        assert.equal(migrated?.runtimeMode, 'artifact');
        assert.equal(activeRelease, migrated?.gatewayCurrentReleaseId);

        await mkdir(join(artifactRoot, 'assets/media/hero'), {
            recursive: true,
        });
        const image = Buffer.from('artifact-image');
        await writeFile(
            join(artifactRoot, 'assets/media/hero/original.png'),
            image,
        );
        const snapshot = {
            origin: 'https://legacy.platform.test',
            primaryHostname: 'legacy.platform.test',
            bindingRevision: 1,
            language: 'en',
            pages: [
                {
                    path: '/',
                    pageKey: 'home',
                    content: { marker: currentArtifact!.marker },
                },
            ],
            navigation: [],
            redirects: [{ from: '/old', to: '/' }],
            paths: ['/', '/old'],
            assets: [
                {
                    path: 'media/hero/original.png',
                    contentBase64: image.toString('base64'),
                    mimeType: 'image/png',
                },
            ],
        };
        await writeFile(
            join(artifactRoot, 'release.json'),
            JSON.stringify({
                releaseId: activeRelease,
                siteHost: 'legacy.platform.test',
                templateId: migrated!.presetId,
                templateVersion: migrated!.presetVersion,
                rendererDigest: recordFor(getPreset('atelier')!).imageDigest,
                snapshot,
                snapshotChecksum: sha(Buffer.from(JSON.stringify(snapshot))),
            }),
        );
        const runtimeRelease = await import(
            // @ts-expect-error JavaScript runtime modules share the CMS runtime contract.
            '../../../storefront/server/utils/runtime-release.mjs'
        );
        const publicRuntime = await import(
            // @ts-expect-error JavaScript runtime modules share the CMS runtime contract.
            '../../../storefront/server/utils/public-runtime.mjs'
        );
        const runtimePage = await import(
            // @ts-expect-error JavaScript runtime modules share the CMS runtime contract.
            '../../../storefront/server/utils/runtime-page.mjs'
        );
        await stopApi();
        const release = await runtimeRelease.readRuntimeRelease({
            artifactRoot,
            siteHost: 'legacy.platform.test',
            releaseId: activeRelease,
        });
        assert.equal(
            (
                await publicRuntime.loadPublicSite({
                    runtimeMode: 'artifact',
                    artifactRoot,
                    releaseId: activeRelease,
                    host: 'legacy.platform.test',
                    path: '/',
                })
            ).content.marker,
            'artifact-current',
        );
        assert.deepEqual(
            await runtimeRelease.readRuntimeAsset(
                release,
                '/_assets/media/hero/original.png',
            ),
            image,
        );
        assert.equal(
            (
                await publicRuntime.loadPublicSite({
                    runtimeMode: 'artifact',
                    artifactRoot,
                    releaseId: activeRelease,
                    host: 'legacy.platform.test',
                    path: '/old',
                })
            ).redirect,
            '/',
        );
        assert.deepEqual(runtimePage.runtimeSitemap(release), ['/', '/old']);

        base = await startApi();
        const rolledBack = await cli(
            ['rollback', '--site', siteId, '--operation', planned.operationId],
            base,
        );
        assert.equal(rolledBack.status, 'rolled-back');
        const restored = await Repo.siteInstallation.methods.findFresh(siteId);
        assert.equal(restored?.runtimeMode, 'legacy');
        assert.equal(restored?.gatewayCurrentReleaseId, 'release-old');

        const replanned = await cli(
            ['plan', '--site', siteId, '--request-key', randomUUID()],
            base,
            stateDirectory,
        );
        const reapplied = await cli(
            ['apply', '--site', siteId, '--operation', replanned.operationId],
            base,
        );
        assert.equal(reapplied.status, 'active');
        assert.equal(
            (await Repo.siteInstallation.methods.findFresh(siteId))
                ?.runtimeMode,
            'artifact',
        );
    },
);
