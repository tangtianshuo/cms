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
    type MigrationRepository,
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

test(
    'real Mongo serializes concurrent site migrations and settles every authority boundary',
    {
        skip: !process.env.STOREFRONT_TEST_MONGO,
        timeout: 60_000,
    },
    async (context) => {
        const app = Fastify();
        await app.register(fastifyMongo, {
            url: process.env.STOREFRONT_TEST_MONGO!,
            database: `migration_recovery_${randomUUID().replaceAll('-', '')}`,
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

        const workspaceId = randomUUID();
        const workspace = {
            workspaceId,
            actorId: 'migration-recovery',
            admin: true,
            instanceAdmin: true,
            role: 'admin' as const,
        };
        await Repo.workspace.add({
            _id: workspaceId,
            name: 'Recovery matrix',
            members: [{ userId: 'migration-recovery', role: 'admin' }],
            createdAt: 1,
            updatedAt: 1,
        });

        type Fixture = {
            label: string;
            siteId: string;
            workspaceId: string;
            oldSite: SiteInstallation;
            oldTemplate: Template;
            oldEntry: Entry;
            newTemplate: Template;
            newEntry: Entry;
            operation: MigrationOperation;
            oldRelease: string;
            newRelease: string;
            oldRevision: number;
            newRevision: number;
        };

        async function seed(label: string, ordinal: number): Promise<Fixture> {
            const siteId = randomUUID();
            const oldTemplate: Template = {
                _id: randomUUID(),
                createdAt: 1,
                updatedAt: 1,
                workspaceId,
                siteId,
                name: `${label}-service-old`,
                label: 'Service',
                desc: '',
                singleEntry: false,
                props: [
                    {
                        id: `${label}-old-title`,
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
                groupId: `${label}-old-group`,
                statuses: [],
                meta: [
                    {
                        lng: 'en',
                        props: [
                            {
                                id: `${label}-old-title`,
                                data: [`${label} service`] as never,
                            },
                        ],
                    },
                    {
                        lng: 'fr',
                        props: [
                            {
                                id: `${label}-old-title`,
                                data: [`service ${label}`] as never,
                            },
                        ],
                    },
                ],
                content: [],
            };
            const oldRelease = `release-old-${ordinal}`;
            const newRelease = `release-new-${ordinal}`;
            const oldRevision = ordinal * 2;
            const newRevision = oldRevision + 1;
            const oldSite: SiteInstallation = {
                _id: siteId,
                workspaceId,
                contentGroupId: `${label}-old-group`,
                templateNamespace: `${label}-old-namespace`,
                slot: `slot-${ordinal}`,
                createdAt: 1,
                updatedAt: 1,
                name: `${label} site`,
                presetId: 'service-studio',
                presetVersion: '1.0.0',
                status: 'ready',
                importError: '',
                includeDemo: false,
                demoSeeded: false,
                gatewayCurrentReleaseId: oldRelease,
                gatewayPublishedReleaseIds: [oldRelease],
                gatewayActiveRevision: oldRevision,
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
                        fields: [
                            { key: 'title', propId: `${label}-old-title` },
                        ],
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
            const newTemplate: Template = {
                ...oldTemplate,
                _id: randomUUID(),
                name: `${label}-service-new`,
                props: [
                    {
                        ...oldTemplate.props[0],
                        id: `${label}-new-title`,
                    },
                ],
            };
            const newEntry: Entry = {
                ...oldEntry,
                _id: randomUUID(),
                templateId: newTemplate._id,
                groupId: `${label}-new-group`,
                meta: oldEntry.meta.map((meta) => ({
                    ...meta,
                    props: meta.props.map((prop) => ({
                        ...prop,
                        id: `${label}-new-title`,
                    })),
                })),
            };
            const candidateSite: SiteInstallation = {
                ...oldSite,
                presetVersion: '1.0.1',
                templateNamespace: `${label}-new-namespace`,
                contentGroupId: newEntry.groupId,
                models: [
                    {
                        key: 'service',
                        templateId: newTemplate._id,
                        fields: [
                            { key: 'title', propId: `${label}-new-title` },
                        ],
                    },
                ],
                pages: [
                    {
                        ...oldSite.pages[0],
                        entryId: newEntry._id,
                    },
                ],
                updatedAt: 2,
            };
            const operation: MigrationOperation = {
                id: randomUUID(),
                cmsWorkspaceId: workspaceId,
                cmsSiteId: siteId,
                requestKey: randomUUID(),
                expectedUpdatedAt: oldSite.updatedAt,
                sourceChecksum: `sha256:${String(ordinal).repeat(64).slice(0, 64)}`,
                targetManifestChecksum: `sha256:${String(ordinal + 3)
                    .repeat(64)
                    .slice(0, 64)}`,
                status: 'staged',
                previousSite: oldSite,
                candidateSite,
                previousReleaseId: oldRelease,
                previousRouteRevision: oldRevision,
                actorId: 'migration-recovery',
                previousTemplates: [oldTemplate],
                candidateTemplates: [newTemplate],
                previousEntries: [oldEntry],
                candidateEntries: [newEntry],
                media: [
                    {
                        _id: randomUUID(),
                        workspaceId,
                        siteId,
                        mimetype: 'image/png',
                        type: 'IMG',
                    } as never,
                ],
                createdAt: ordinal,
                updatedAt: ordinal,
            };
            await runWithWorkspace(workspace, async () => {
                // The mutation store cannot claim a site before its document
                // exists; seed the complete installation atomically first.
                await app.mongo
                    .db!.collection(Repo.siteInstallation.collection)
                    .insertOne(oldSite as never);
                await Repo.template.add(oldTemplate, true);
                await Repo.entry.add(oldEntry, true);
                await mongoMigrationRepository().save(operation);
            });
            return {
                label,
                siteId,
                workspaceId,
                oldSite,
                oldTemplate,
                oldEntry,
                newTemplate,
                newEntry,
                operation,
                oldRelease,
                newRelease,
                oldRevision,
                newRevision,
            };
        }

        function stateFor(fixture: Fixture, old: boolean): GatewayState {
            return {
                revision: old ? fixture.oldRevision : fixture.newRevision,
                active: {
                    releaseId: old ? fixture.oldRelease : fixture.newRelease,
                    imageDigest: `sha256:${(old ? 'c' : 'd').repeat(64)}`,
                    routeRevision: old
                        ? fixture.oldRevision
                        : fixture.newRevision,
                    metadata: {},
                    snapshot: {
                        schemaVersion: 1,
                        siteId: fixture.siteId,
                        language: 'en',
                        pages: [],
                        navigation: [],
                        redirects: [],
                    },
                    createdAt: new Date().toISOString(),
                },
            };
        }

        const gatewayStates = new Map<string, GatewayState>();
        function runtime(
            fixture: Fixture,
            options: {
                repository?: MigrationRepository;
                finalize?: MigrationRuntime['finalize'];
            } = {},
        ): MigrationRuntime {
            const repository = options.repository || mongoMigrationRepository();
            const readState = () =>
                gatewayStates.get(fixture.siteId) || stateFor(fixture, true);
            const saveState = (value: GatewayState) => {
                gatewayStates.set(fixture.siteId, value);
                return value;
            };
            const base: GatewayReleaseSource = {
                findSite: () =>
                    Repo.siteInstallation.methods.findFresh(fixture.siteId),
                loadContent: async () => {
                    throw new Error('unused');
                },
                findRelease: async () => null,
                insertRelease: async (_record: ReleaseRecord) => undefined,
                activate: async () => true,
                audit: async () => undefined,
                saveSite: async () => true,
                projectGatewayRelease: async () => true,
            };
            const finalize =
                options.finalize ||
                ((value: MigrationOperation, expected: number) =>
                    Repo.siteInstallation.methods.finalizeMigration(
                        value.cmsSiteId,
                        value.id,
                        expected,
                        value.candidateSite,
                    ));
            return {
                repository,
                findSite: (id) => Repo.siteInstallation.methods.findFresh(id),
                sourceChecksum: async (value) => value.sourceChecksum,
                source: (value) =>
                    createMigrationReleaseSource(value, {
                        base,
                        update: (next) => repository.save(next),
                    }),
                persistCandidate: async (value) => {
                    await Repo.entryGroup.methods.ensure(
                        value.candidateSite.contentGroupId ||
                            `${value.cmsSiteId}-migration-${value.id}`,
                        value.cmsSiteId,
                        `${fixture.label} candidate`,
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
                finalize,
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
                    publish: async (_source, operation) => {
                        const state = saveState(stateFor(fixture, false));
                        const persisted = await repository.find(operation.id);
                        if (persisted) {
                            await repository.save({
                                ...persisted,
                                status: 'publishing',
                                recoveryPhase: 'gateway-active',
                                targetReleaseId: fixture.newRelease,
                                targetRouteRevision: fixture.newRevision,
                                candidateSite: {
                                    ...persisted.candidateSite,
                                    gatewayCurrentReleaseId: fixture.newRelease,
                                    gatewayPublishedReleaseIds: [
                                        fixture.oldRelease,
                                        fixture.newRelease,
                                    ],
                                    gatewayActiveRevision: fixture.newRevision,
                                    updatedAt: Math.max(
                                        Date.now(),
                                        persisted.candidateSite.updatedAt + 1,
                                    ),
                                },
                                updatedAt: Date.now(),
                            });
                        }
                        return {
                            state,
                            targetReleaseId: fixture.newRelease,
                            targetRouteRevision: fixture.newRevision,
                        };
                    },
                    readState: async () => readState(),
                    rollback: async () => {
                        return saveState(stateFor(fixture, true));
                    },
                },
            };
        }

        const first = await seed('alpha', 1);
        const second = await seed('beta', 2);
        const crashBeforeCas = await seed('gamma', 3);
        const crashAfterCas = await seed('delta', 4);
        const unrelated = await seed('epsilon', 5);

        const concurrent = await runWithWorkspace(workspace, () =>
            Promise.all([
                new MigrationService(runtime(first)).adopt(
                    first.operation.id,
                    first.operation.sourceChecksum,
                    'migration-recovery',
                ),
                new MigrationService(runtime(second)).adopt(
                    second.operation.id,
                    second.operation.sourceChecksum,
                    'migration-recovery',
                ),
            ]),
        );
        assert.deepEqual(
            concurrent.map((value) => value.status),
            ['active', 'active'],
        );
        const firstSite = await Repo.siteInstallation.methods.findFresh(
            first.siteId,
        );
        const secondSite = await Repo.siteInstallation.methods.findFresh(
            second.siteId,
        );
        assert.equal(firstSite?.templateNamespace, 'alpha-new-namespace');
        assert.equal(secondSite?.templateNamespace, 'beta-new-namespace');
        const [firstCandidateEntry, secondCandidateEntry] =
            await runWithWorkspace(workspace, () =>
                Promise.all([
                    Repo.entry.findById(first.newEntry._id),
                    Repo.entry.findById(second.newEntry._id),
                ]),
            );
        assert.equal(firstCandidateEntry?.groupId, first.newEntry.groupId);
        assert.equal(secondCandidateEntry?.groupId, second.newEntry.groupId);
        await runWithWorkspace(workspace, () =>
            withSiteMutation(unrelated.siteId, async () => {
                const site = (await Repo.siteInstallation.methods.findFresh(
                    unrelated.siteId,
                ))!;
                await Repo.siteInstallation.update({
                    ...site,
                    name: 'Still independently editable',
                    updatedAt: site.updatedAt + 1,
                });
            }),
        );
        assert.equal(
            (await Repo.siteInstallation.methods.findFresh(unrelated.siteId))
                ?.name,
            'Still independently editable',
        );
        assert.equal(
            await Repo.siteInstallation.methods.claimSiteMutation(
                first.siteId,
                'duplicate-owner',
                'migration',
                'different-operation',
                Date.now(),
                Date.now() + 30_000,
            ),
            false,
        );

        const beforeCasRuntime = runtime(crashBeforeCas, {
            finalize: async () => {
                throw new Error('simulated crash before CMS CAS');
            },
        });
        await assert.rejects(
            () =>
                runWithWorkspace(workspace, () =>
                    new MigrationService(beforeCasRuntime).adopt(
                        crashBeforeCas.operation.id,
                        crashBeforeCas.operation.sourceChecksum,
                        'migration-recovery',
                    ),
                ),
            /crash before CMS CAS/,
        );
        assert.equal(
            (
                await Repo.siteInstallation.methods.findFresh(
                    crashBeforeCas.siteId,
                )
            )?.templateNamespace,
            crashBeforeCas.oldSite.templateNamespace,
        );
        const recoveredBeforeCas = await runWithWorkspace(workspace, () =>
            new MigrationService(runtime(crashBeforeCas)).reconcile(
                crashBeforeCas.operation.id,
            ),
        );
        assert.equal(recoveredBeforeCas.status, 'active');

        let failActiveSave = true;
        const afterCasRepository = {
            ...mongoMigrationRepository(),
            save: async (value: MigrationOperation) => {
                if (failActiveSave && value.status === 'active') {
                    throw new Error('simulated crash after CMS CAS');
                }
                await mongoMigrationRepository().save(value);
            },
        };
        await assert.rejects(
            () =>
                runWithWorkspace(workspace, () =>
                    new MigrationService(
                        runtime(crashAfterCas, {
                            repository: afterCasRepository,
                        }),
                    ).adopt(
                        crashAfterCas.operation.id,
                        crashAfterCas.operation.sourceChecksum,
                        'migration-recovery',
                    ),
                ),
            /crash after CMS CAS/,
        );
        assert.equal(
            (
                await Repo.siteInstallation.methods.findFresh(
                    crashAfterCas.siteId,
                )
            )?.migrationState,
            'active',
        );
        failActiveSave = false;
        const recoveredAfterCas = await runWithWorkspace(workspace, () =>
            new MigrationService(runtime(crashAfterCas)).reconcile(
                crashAfterCas.operation.id,
            ),
        );
        assert.equal(recoveredAfterCas.status, 'active');

        let failRollbackSave = true;
        const rollbackRepository = {
            ...mongoMigrationRepository(),
            save: async (value: MigrationOperation) => {
                if (failRollbackSave && value.status === 'rolled-back') {
                    throw new Error('simulated crash after site restore');
                }
                await mongoMigrationRepository().save(value);
            },
        };
        await assert.rejects(
            () =>
                runWithWorkspace(workspace, () =>
                    new MigrationService(
                        runtime(crashAfterCas, {
                            repository: rollbackRepository,
                        }),
                    ).rollback(
                        crashAfterCas.operation.id,
                        'migration-recovery',
                    ),
                ),
            /crash after site restore/,
        );
        assert.equal(
            (
                await Repo.siteInstallation.methods.findFresh(
                    crashAfterCas.siteId,
                )
            )?.migrationState,
            'rolled-back',
        );
        failRollbackSave = false;
        const recoveredRollback = await runWithWorkspace(workspace, () =>
            new MigrationService(runtime(crashAfterCas)).reconcile(
                crashAfterCas.operation.id,
            ),
        );
        assert.equal(recoveredRollback.status, 'rolled-back');
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(crashAfterCas.oldEntry._id),
            ),
        );
        assert.ok(
            await runWithWorkspace(workspace, () =>
                Repo.entry.findById(crashAfterCas.newEntry._id),
            ),
        );
        assert.equal(
            (
                await runWithWorkspace(workspace, () =>
                    mongoMigrationRepository().find(crashAfterCas.operation.id),
                )
            )?.media?.length,
            1,
        );
    },
);
