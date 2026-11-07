import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyMongo from '@fastify/mongodb';
import { Repo } from '../repo';
import { runWithWorkspace } from '../workspaces/context';
import type { SiteInstallation } from '../presets/site-model';
import type { Template } from '../template/models/main';
import type { Entry } from '../entry/models/main';
import type { GatewayReleaseSource } from '../presets/gateway-publish';
import type { GatewayState } from '../presets/gateway-state';
import type { ReleaseRecord } from '../presets/releases';
import { PropType } from '../prop/models/main';
import {
    initMigrationRepository,
    mongoMigrationRepository,
    type MigrationOperation,
} from './migration-repo';
import {
    setSiteMutationStore,
    SiteMutationConflict,
    withSiteMutation,
} from './site-mutation';
import { MigrationService, type MigrationRuntime } from './migration-service';
import { createMigrationReleaseSource } from './migration-source';

test(
    'real Mongo persists migration operations and enforces publishing write blocking',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 60_000,
    },
    async (context) => {
        const app = Fastify();
        await app.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        context.after(async () => {
            await app.mongo.db?.dropDatabase();
            await app.close();
        });
        for (const repo of [Repo.siteInstallation]) {
            await new Promise<void>((resolve, reject) =>
                repo.init().initialize({
                    fastify: app,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
            );
        }
        await initMigrationRepository(app);
        setSiteMutationStore(Repo.siteInstallation.methods);
        const siteId = randomUUID();
        const site: SiteInstallation = {
            _id: siteId,
            workspaceId: 'default',
            slot: 'default',
            createdAt: 1,
            updatedAt: 1,
            name: 'Migration integration',
            presetId: 'service-studio',
            presetVersion: '1.0.0',
            status: 'ready',
            importError: '',
            includeDemo: false,
            demoSeeded: false,
            theme: {
                background: '#ffffff',
                foreground: '#111111',
                accent: '#0066cc',
                muted: '#eeeeee',
                font: 'Arial',
            },
            models: [],
            pages: [],
        };
        const otherSiteId = randomUUID();
        const otherSite: SiteInstallation = {
            ...site,
            _id: otherSiteId,
            slot: 'secondary',
            name: 'Unrelated migration integration',
        };
        await runWithWorkspace(
            {
                workspaceId: 'default',
                actorId: 'migration-test',
                admin: true,
                instanceAdmin: true,
                role: 'admin',
            },
            async () => {
                await Repo.siteInstallation.add(site);
                await Repo.siteInstallation.add(otherSite);
            },
        );
        await withSiteMutation(
            siteId,
            async () => {
                assert.equal(
                    (
                        await Repo.siteInstallation.methods.siteMutationState(
                            siteId,
                        )
                    ).status,
                    'publishing',
                );

                let otherMigrationRan = false;
                await withSiteMutation(
                    otherSiteId,
                    async () => {
                        otherMigrationRan = true;
                    },
                    { mode: 'migration', operationId: 'operation-2' },
                );
                assert.equal(otherMigrationRan, true);
            },
            { mode: 'migration', operationId: 'operation-1' },
        );
        await assert.rejects(
            () => withSiteMutation(siteId, async () => undefined),
            SiteMutationConflict,
        );
        assert.equal(
            await Repo.siteInstallation.methods.claimSiteMutation(
                siteId,
                'different-token',
                'migration',
                'operation-2',
                Date.now(),
                Date.now() + 30_000,
            ),
            false,
        );
        const candidate: SiteInstallation = {
            ...site,
            presetVersion: '1.0.1',
            templateNamespace: 'candidate-namespace',
            contentGroupId: 'candidate-content',
            gatewayCurrentReleaseId: 'release-2',
            gatewayPublishedReleaseIds: ['release-1', 'release-2'],
            gatewayActiveRevision: 4,
            updatedAt: 2,
        };
        const operation: MigrationOperation = {
            id: randomUUID(),
            cmsWorkspaceId: 'default',
            cmsSiteId: siteId,
            requestKey: randomUUID(),
            expectedUpdatedAt: 1,
            sourceChecksum: `sha256:${'a'.repeat(64)}`,
            targetManifestChecksum: `sha256:${'b'.repeat(64)}`,
            status: 'staged',
            previousSite: site,
            candidateSite: candidate,
            previousReleaseId: 'release-1',
            previousRouteRevision: 3,
            createdAt: 1,
            updatedAt: 1,
        };
        const first = mongoMigrationRepository();
        await first.save(operation);
        const reloaded = await mongoMigrationRepository().findByRequestKey(
            'default',
            siteId,
            operation.requestKey,
        );
        assert.ok(reloaded);
        assert.equal(reloaded?.id, operation.id);
        assert.equal(reloaded?.candidateSite.presetVersion, '1.0.1');
        assert.equal(
            await Repo.siteInstallation.methods.finalizeMigration(
                siteId,
                'operation-1',
                site.updatedAt,
                candidate,
            ),
            true,
        );
        assert.equal(
            (await Repo.siteInstallation.methods.siteMutationState(siteId))
                .status,
            'active',
        );
        const finalized = await Repo.siteInstallation.methods.findFresh(siteId);
        assert.equal(finalized?.templateNamespace, 'candidate-namespace');
        assert.equal(finalized?.contentGroupId, 'candidate-content');
        assert.equal(finalized?.gatewayCurrentReleaseId, 'release-2');
        assert.deepEqual(finalized?.gatewayPublishedReleaseIds, [
            'release-1',
            'release-2',
        ]);
        assert.equal(finalized?.gatewayActiveRevision, 4);
        await withSiteMutation(siteId, async () => undefined);
    },
);

test(
    'full Mongo migration keeps complete candidate identities and retains old data on rollback',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 60_000,
    },
    async (context) => {
        const app = Fastify();
        await app.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_full_${randomUUID().replaceAll('-', '')}`,
            forceClose: true,
        });
        context.after(async () => {
            await app.mongo.db?.dropDatabase();
            await app.close();
        });
        for (const repo of [
            Repo.siteInstallation,
            Repo.template,
            Repo.entry,
            Repo.entryGroup,
            Repo.workspace,
        ]) {
            await new Promise<void>((resolve, reject) =>
                repo.init().initialize({
                    fastify: app,
                    next: (error?: Error) =>
                        error ? reject(error) : resolve(),
                } as never),
            );
        }
        await initMigrationRepository(app);
        setSiteMutationStore(Repo.siteInstallation.methods);

        const siteId = randomUUID();
        const workspaceId = randomUUID();
        const oldTemplate: Template = {
            _id: randomUUID(),
            createdAt: 1,
            updatedAt: 1,
            workspaceId,
            siteId,
            name: 'services',
            label: 'Services',
            desc: '',
            singleEntry: false,
            props: [
                {
                    id: 'old-title',
                    name: 'title',
                    label: 'Title',
                    type: PropType.STRING,
                    required: true,
                    array: false,
                    data: {},
                },
            ],
        };
        const oldEntry: Entry = {
            _id: randomUUID(),
            createdAt: 1,
            updatedAt: 1,
            workspaceId,
            siteId,
            templateId: oldTemplate._id,
            userId: 'user',
            groupId: 'old-group',
            statuses: [],
            meta: [
                {
                    lng: 'en',
                    props: [{ id: 'old-title', data: ['Strategy'] as never }],
                },
                {
                    lng: 'fr',
                    props: [
                        {
                            id: 'old-title',
                            data: ['Stratégie'] as never,
                        },
                    ],
                },
            ],
            content: [],
        };
        const oldSite: SiteInstallation = {
            _id: siteId,
            workspaceId,
            contentGroupId: 'old-group',
            templateNamespace: 'old-namespace',
            slot: 'default',
            createdAt: 1,
            updatedAt: 1,
            name: 'Complete migration',
            presetId: 'service-studio',
            presetVersion: '1.0.0',
            status: 'ready',
            importError: '',
            includeDemo: false,
            demoSeeded: false,
            gatewayCurrentReleaseId: 'release-1',
            gatewayPublishedReleaseIds: ['release-1'],
            gatewayActiveRevision: 3,
            theme: {
                background: '#fff',
                foreground: '#111',
                accent: '#06c',
                muted: '#eee',
                font: 'Arial',
            },
            models: [
                {
                    key: 'service',
                    templateId: oldTemplate._id,
                    fields: [{ key: 'title', propId: 'old-title' }],
                },
            ],
            pages: [
                {
                    key: 'services',
                    title: 'Services',
                    path: '/services',
                    modelKey: 'service',
                    layout: 'content-page',
                    status: 'draft',
                    entryId: oldEntry._id,
                    sections: [],
                    enabled: true,
                },
            ],
        };
        const workspace = {
            workspaceId,
            siteId,
            actorId: 'admin',
            admin: true,
            instanceAdmin: true,
            role: 'admin' as const,
        };
        await Repo.workspace.add({
            _id: workspaceId,
            name: 'Migration integration',
            members: [{ userId: 'migration-integration', role: 'admin' }],
            createdAt: 1,
            updatedAt: 1,
        });
        await runWithWorkspace(workspace, async () => {
            await Repo.siteInstallation.add(oldSite);
            await Repo.template.add(oldTemplate, true);
            await Repo.entry.add(oldEntry, true);
        });
        const persistedOldSite = await runWithWorkspace(workspace, () =>
            Repo.siteInstallation.methods.findFresh(siteId),
        );
        assert.ok(persistedOldSite);
        assert.equal(
            (await Repo.siteInstallation.methods.siteMutationState(siteId))
                .status,
            'idle',
        );
        const newTemplate: Template = {
            ...oldTemplate,
            _id: randomUUID(),
            name: 'candidate-services',
            props: [
                {
                    ...oldTemplate.props[0],
                    id: 'new-title',
                },
            ],
        };
        const newEntry: Entry = {
            ...oldEntry,
            _id: randomUUID(),
            templateId: newTemplate._id,
            groupId: 'candidate-group',
            meta: oldEntry.meta.map((meta) => ({
                ...meta,
                props: meta.props.map((prop) => ({
                    ...prop,
                    id: 'new-title',
                })),
            })),
        };
        const candidateSite: SiteInstallation = {
            ...persistedOldSite,
            presetVersion: '1.0.1',
            templateNamespace: 'candidate-namespace',
            contentGroupId: 'candidate-group',
            models: [
                {
                    key: 'service',
                    templateId: newTemplate._id,
                    fields: [{ key: 'title', propId: 'new-title' }],
                },
            ],
            pages: [
                {
                    ...oldSite.pages[0],
                    entryId: newEntry._id,
                },
            ],
            gatewayCurrentReleaseId: 'release-1',
            gatewayPublishedReleaseIds: ['release-1'],
            gatewayActiveRevision: 3,
            updatedAt: persistedOldSite.updatedAt + 1,
        };
        const media = {
            _id: randomUUID(),
            createdAt: 1,
            updatedAt: 1,
            workspaceId,
            siteId,
            mimetype: 'image/png',
            type: 'IMG',
            size: 12,
        };
        const operation: MigrationOperation = {
            id: randomUUID(),
            cmsWorkspaceId: workspaceId,
            cmsSiteId: siteId,
            requestKey: randomUUID(),
            expectedUpdatedAt: persistedOldSite.updatedAt,
            sourceChecksum: `sha256:${'a'.repeat(64)}`,
            targetManifestChecksum: `sha256:${'b'.repeat(64)}`,
            status: 'staged',
            previousSite: persistedOldSite,
            candidateSite,
            previousReleaseId: 'release-1',
            previousRouteRevision: 3,
            targetReleaseId: 'release-2',
            targetRouteRevision: 4,
            actorId: 'admin',
            previousTemplates: [oldTemplate],
            candidateTemplates: [newTemplate],
            previousEntries: [oldEntry],
            candidateEntries: [newEntry],
            media: [media as never],
            createdAt: 1,
            updatedAt: 1,
        };
        const repository = mongoMigrationRepository();
        await runWithWorkspace(workspace, () => repository.save(operation));
        let gatewayState: GatewayState = {
            revision: 3,
            active: {
                releaseId: 'release-1',
                imageDigest: `sha256:${'c'.repeat(64)}`,
                routeRevision: 3,
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
        };
        const baseSource = {
            findSite: async () => oldSite,
            loadContent: async () => {
                throw new Error('unused');
            },
            findRelease: async () => null,
            insertRelease: async (_record: ReleaseRecord) => undefined,
            activate: async () => true,
            audit: async () => undefined,
            saveSite: async () => true,
            projectGatewayRelease: async () => true,
        } satisfies GatewayReleaseSource;
        const runtime: MigrationRuntime = {
            repository,
            findSite: (id) => Repo.siteInstallation.methods.findFresh(id),
            sourceChecksum: async (value) => value.sourceChecksum,
            source: (value) =>
                createMigrationReleaseSource(value, {
                    base: baseSource,
                    update: async (next) => {
                        await repository.save(next);
                    },
                }),
            persistCandidate: async (value) => {
                await Repo.entryGroup.methods.ensure(
                    value.candidateSite.contentGroupId ||
                        `${value.cmsSiteId}-migration-${value.id}`,
                    value.cmsSiteId,
                    'Migration candidate',
                );
                for (const template of value.candidateTemplates || []) {
                    if (!(await Repo.template.findById(template._id)))
                        await Repo.template.add(template, true);
                }
                for (const entry of value.candidateEntries || []) {
                    if (!(await Repo.entry.findById(entry._id)))
                        await Repo.entry.add(entry, true);
                }
            },
            finalize: (value, expected) =>
                Repo.siteInstallation.methods.finalizeMigration(
                    value.cmsSiteId,
                    value.id,
                    expected,
                    value.candidateSite,
                ),
            restore: (value, expected, previous) =>
                Repo.siteInstallation.methods.restoreMigrationSite(
                    value.cmsSiteId,
                    value.id,
                    expected,
                    previous,
                ),
            settle: (value, status) =>
                Repo.siteInstallation.methods.settleMigrationState(
                    value.cmsSiteId,
                    value.id,
                    status,
                ),
            gateway: {
                publish: async (_source, value) => {
                    gatewayState = {
                        revision: 4,
                        active: {
                            releaseId: 'release-2',
                            imageDigest: `sha256:${'d'.repeat(64)}`,
                            routeRevision: 4,
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
                    };
                    const persisted = await repository.find(value.id);
                    if (persisted) {
                        await repository.save({
                            ...persisted,
                            candidateSite: {
                                ...persisted.candidateSite,
                                gatewayCurrentReleaseId: 'release-2',
                                gatewayPublishedReleaseIds: [
                                    'release-1',
                                    'release-2',
                                ],
                                gatewayActiveRevision: 4,
                                updatedAt: Math.max(
                                    Date.now(),
                                    persisted.candidateSite.updatedAt + 1,
                                ),
                            },
                            updatedAt: Date.now(),
                        });
                        const saved = await repository.find(value.id);
                        assert.equal(
                            saved?.candidateSite.gatewayCurrentReleaseId,
                            'release-2',
                        );
                    }
                    return {
                        state: gatewayState,
                        targetReleaseId: 'release-2',
                        targetRouteRevision: 4,
                    };
                },
                readState: async () => gatewayState,
                rollback: async () => {
                    gatewayState = {
                        revision: 5,
                        active: {
                            releaseId: 'release-1',
                            imageDigest: `sha256:${'c'.repeat(64)}`,
                            routeRevision: 3,
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
                    };
                    return gatewayState;
                },
            },
        };
        const service = new MigrationService(runtime);
        const active = await runWithWorkspace(workspace, () =>
            service.adopt(operation.id, operation.sourceChecksum, 'admin'),
        );
        assert.equal(active.status, 'active');
        assert.equal(active.candidateSite.gatewayCurrentReleaseId, 'release-2');
        const persistedOperation = await runWithWorkspace(workspace, () =>
            repository.find(operation.id),
        );
        assert.equal(
            persistedOperation?.candidateSite.gatewayCurrentReleaseId,
            'release-2',
        );
        const finalized = await Repo.siteInstallation.methods.findFresh(siteId);
        assert.equal(finalized?.templateNamespace, 'candidate-namespace');
        assert.equal(finalized?.contentGroupId, 'candidate-group');
        assert.equal(finalized?.gatewayCurrentReleaseId, 'release-2');
        assert.deepEqual(finalized?.gatewayPublishedReleaseIds, [
            'release-1',
            'release-2',
        ]);
        assert.equal(finalized?.gatewayActiveRevision, 4);
        assert.deepEqual(
            finalized?.models.map((model) => model.templateId),
            [newTemplate._id],
        );
        await assert.rejects(
            () =>
                runWithWorkspace(workspace, () =>
                    Repo.entry.add({ ...oldEntry, _id: randomUUID() }, true),
                ),
            SiteMutationConflict,
        );
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(oldEntry._id),
            ),
        );
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(newEntry._id),
            ),
        );
        const rolledBack = await runWithWorkspace(workspace, () =>
            service.rollback(operation.id, 'admin'),
        );
        assert.equal(rolledBack.status, 'rolled-back');
        const restored = await Repo.siteInstallation.methods.findFresh(siteId);
        assert.equal(restored?.templateNamespace, 'old-namespace');
        assert.equal(restored?.gatewayCurrentReleaseId, 'release-1');
        assert.deepEqual(restored?.gatewayPublishedReleaseIds, ['release-1']);
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(oldEntry._id),
            ),
        );
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(newEntry._id),
            ),
        );
        const retained = await runWithWorkspace(workspace, () =>
            repository.find(operation.id),
        );
        assert.equal(retained?.media?.length, 1);
    },
);
