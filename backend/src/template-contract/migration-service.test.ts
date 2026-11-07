import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { PresetManifest } from '../presets/catalog';
import type { GatewayReleaseSource } from '../presets/gateway-publish';
import { publishGatewayRelease } from '../presets/gateway-publish';
import type { GatewayState } from '../presets/gateway-state';
import type { ReleaseInput, ReleaseRecord } from '../presets/releases';
import type { SiteInstallation } from '../presets/site-model';
import type { Template } from '../template/models/main';
import type { PublicTemplateRecord } from '../presets/registry';
import { canonicalJson } from '../presets/registry';
import { PropType } from '../prop/models/main';
import {
    canFinalizeMigration,
    MigrationService,
    prepareMigrationOperation,
    type MigrationRuntime,
} from './migration-service';
import {
    createMemoryMigrationRepository,
    type MigrationOperation,
} from './migration-repo';
import { createMigrationReleaseSource } from './migration-source';
import { runMigrationRecoveryTick } from '../presets/gateway-jobs';

const cmsSiteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const manifest: PresetManifest = {
    id: 'service-studio',
    version: '1.0.1',
    name: 'Service',
    description: 'Service',
    compatibility: {
        cmsSchema: 1,
        releaseSchema: 1,
        migrations: [
            {
                from: 'service-studio@1.0.0',
                to: 'service-studio@1.0.1',
                steps: [],
            },
        ],
    },
    theme: {
        background: '#ffffff',
        foreground: '#111111',
        accent: '#0066cc',
        muted: '#eeeeee',
        font: 'Arial',
    },
    models: [
        {
            key: 'service',
            label: 'Services',
            description: 'Services',
            singleEntry: false,
            fields: [
                {
                    key: 'title',
                    label: 'Title',
                    type: PropType.STRING,
                    required: true,
                    array: false,
                },
                {
                    key: 'summary',
                    label: 'Summary',
                    type: PropType.STRING,
                    required: false,
                    array: false,
                },
                {
                    key: 'cover',
                    label: 'Cover',
                    type: PropType.MEDIA,
                    required: false,
                    array: false,
                },
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
        },
    ],
    editor: {
        schemaVersion: 1,
        models: [
            {
                modelKey: 'service',
                fields: [
                    {
                        key: 'title',
                        label: 'Title',
                        control: 'text',
                    },
                    {
                        key: 'summary',
                        label: 'Summary',
                        control: 'text',
                    },
                    {
                        key: 'cover',
                        label: 'Cover',
                        control: 'media',
                    },
                ],
            },
        ],
        pages: [
            {
                pageKey: 'services',
                modelKey: 'service',
                pathRule: { type: 'fixed', value: '/services' },
                allowNavigation: true,
                sections: ['hero'],
            },
        ],
        sections: [
            {
                type: 'hero',
                label: 'Hero',
                allowedPages: ['services'],
                singleton: true,
                required: true,
                props: {},
            },
        ],
        operations: {
            canCreatePages: true,
            canEditNavigation: true,
            canPublish: true,
        },
    },
    renderer: {
        contractVersion: 1,
        templateId: 'service-studio',
        templateVersion: '1.0.1',
        preview: { protocolVersion: 1, capabilities: ['draft'] },
        assets: { mode: 'published', basePath: '/_assets/' },
    },
    demo: {
        brand: 'Studio',
        hero: { title: '', subtitle: '', image: '' },
        product: { title: '', price: '', image: '', description: '' },
        collection: { title: '', description: '', image: '' },
        page: { title: '', body: '', image: '' },
    },
};

const record: PublicTemplateRecord = {
    schemaVersion: 1,
    id: 'service-studio',
    version: '1.0.1',
    manifestChecksum: `sha256:${'a'.repeat(64)}`,
    imageRepository:
        'ghcr.io/tangtianshuo/independent-website-templates/service-studio',
    imageDigest: `sha256:${'b'.repeat(64)}`,
    sourceCommit: 'c'.repeat(40),
    manifestPath: 'templates/service-studio/1.0.1/template.json',
    status: 'available',
};

const installedManifest = {
    ...manifest,
    version: '1.0.0',
    renderer: { ...manifest.renderer, templateVersion: '1.0.0' },
};
const installedRecord: PublicTemplateRecord = {
    ...record,
    version: '1.0.0',
    manifestChecksum: `sha256:${createHash('sha256')
        .update(canonicalJson(installedManifest), 'utf8')
        .digest('hex')}`,
    manifestPath: 'templates/service-studio/1.0.0/template.json',
};

function fixture() {
    const site: SiteInstallation = {
        _id: cmsSiteId,
        createdAt: 1,
        updatedAt: 2,
        workspaceId: 'workspace-1',
        slot: 'default',
        name: 'Service site',
        presetId: 'service-studio',
        presetVersion: '1.0.0',
        status: 'ready',
        importError: '',
        includeDemo: false,
        demoSeeded: false,
        language: 'en',
        theme: { ...manifest.theme },
        presetManifestSnapshot: JSON.stringify(installedManifest),
        publishedTemplateRecord: JSON.stringify(installedRecord),
        gatewayCurrentReleaseId: 'release-old',
        gatewayPublishedReleaseIds: ['release-old'],
        gatewayActiveRevision: 3,
        models: [
            {
                key: 'service',
                templateId: 'template-old',
                fields: [
                    { key: 'title', propId: 'prop-title' },
                    { key: 'summary', propId: 'prop-summary' },
                    { key: 'cover', propId: 'prop-cover' },
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
                entryId: 'entry-1',
                sections: ['hero'],
                sectionConfigs: [
                    { type: 'hero' as never, enabled: true, data: {} },
                ],
                enabled: true,
                navigation: true,
            },
        ],
    };
    const template: Template = {
        _id: 'template-old',
        createdAt: 1,
        updatedAt: 1,
        workspaceId: 'workspace-1',
        siteId: cmsSiteId,
        name: 'services',
        label: 'Services',
        desc: '',
        singleEntry: false,
        props: [
            {
                id: 'prop-title',
                name: 'title',
                label: 'Title',
                type: PropType.STRING,
                required: true,
                array: false,
                data: {},
            },
            {
                id: 'prop-summary',
                name: 'summary',
                label: 'Summary',
                type: PropType.STRING,
                required: false,
                array: false,
                data: {},
            },
            {
                id: 'prop-cover',
                name: 'cover',
                label: 'Cover',
                type: PropType.MEDIA,
                required: false,
                array: false,
                data: {},
            },
        ],
    };
    const entry: Entry = {
        _id: 'entry-1',
        createdAt: 1,
        updatedAt: 1,
        workspaceId: 'workspace-1',
        siteId: cmsSiteId,
        groupId: 'group-1',
        templateId: 'template-old',
        userId: 'user-1',
        statuses: [],
        meta: [
            {
                lng: 'en',
                props: [
                    { id: 'prop-title', data: ['Strategy'] as never },
                    { id: 'prop-summary', data: ['Summary'] as never },
                    {
                        id: 'prop-cover',
                        data: [{ _id: 'media-1' }] as never,
                    },
                ],
            },
        ],
        content: [{ lng: 'en', nodes: [], plainText: '' }],
    };
    const media = {
        _id: 'media-1',
        workspaceId: 'workspace-1',
        siteId: cmsSiteId,
        mimetype: 'image/png',
        type: 'IMG',
    } as Media;
    const input: ReleaseInput = {
        site,
        templates: [template],
        entries: [entry],
        media: [media],
        language: 'en',
        mediaOrigin: 'https://cms.example',
        currency: 'USD',
    };
    return { site, template, entry, media, input };
}

function memoryRuntime() {
    let site: SiteInstallation;
    let gatewayState: GatewayState;
    let publishError: Error | null = null;
    let gatewayPublishCount = 0;
    let checksumOverride: string | null = null;
    const baseSource = {
        findSite: async () => site,
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
    const repository = createMemoryMigrationRepository();
    const runtime: MigrationRuntime = {
        repository,
        findSite: async () => site,
        sourceChecksum: async (operation) =>
            checksumOverride || operation.sourceChecksum,
        source: (operation) =>
            createMigrationReleaseSource(operation, {
                base: baseSource,
                update: async (next) => {
                    await repository.save(next);
                },
            }),
        persistCandidate: async () => undefined,
        finalize: async (operation) => {
            site = {
                ...structuredClone(operation.candidateSite),
                updatedAt: site.updatedAt + 1,
                migrationState: 'active',
                migrationOperationId: operation.id,
            };
            return true;
        },
        restore: async (operation, _expected, previous) => {
            site = {
                ...structuredClone(previous),
                updatedAt: site.updatedAt + 1,
                migrationState: 'rolled-back',
                migrationOperationId: operation.id,
            };
            return true;
        },
        settle: async () => true,
        gateway: {
            publish: async () => {
                gatewayPublishCount += 1;
                if (publishError) throw publishError;
                return {
                    state: gatewayState,
                    targetReleaseId: 'release-new',
                    targetRouteRevision: 4,
                };
            },
            readState: async () => gatewayState,
            rollback: async () => ({
                revision: 5,
                active: {
                    releaseId: 'release-old',
                    imageDigest: record.imageDigest,
                    routeRevision: 3,
                    metadata: {},
                    snapshot: {
                        schemaVersion: 1,
                        siteId: cmsSiteId,
                        language: 'en',
                        pages: [],
                        navigation: [],
                        redirects: [],
                    },
                    createdAt: new Date().toISOString(),
                },
            }),
        },
    };
    return {
        runtime,
        setSite: (value: SiteInstallation) => {
            site = value;
        },
        site: () => site,
        setGatewayState: (value: GatewayState) => {
            gatewayState = value;
        },
        setPublishError: (value: Error | null) => {
            publishError = value;
        },
        setChecksumOverride: (value: string | null) => {
            checksumOverride = value;
        },
        gatewayPublishCount: () => gatewayPublishCount,
    };
}

test('canFinalizeMigration requires the exact authoritative tuple', () => {
    const active = {
        releaseId: 'target',
        routeRevision: 4,
        imageDigest: `sha256:${'b'.repeat(64)}`,
        metadata: {},
        snapshot: {
            schemaVersion: 1 as const,
            siteId: cmsSiteId,
            language: 'en',
            pages: [],
            navigation: [],
            redirects: [],
        },
        createdAt: new Date().toISOString(),
    };
    assert.equal(
        canFinalizeMigration('target', 4, {
            revision: 4,
            active,
        }),
        true,
    );
    assert.equal(
        canFinalizeMigration('target', 5, {
            revision: 5,
            active,
        }),
        false,
    );
});

test('background recovery scopes each operation to its own workspace and site', async () => {
    const calls: string[] = [];
    await runMigrationRecoveryTick(
        async () => [
            {
                id: 'operation-a',
                cmsWorkspaceId: 'workspace-a',
                cmsSiteId: 'site-a',
            },
            {
                id: 'operation-b',
                cmsWorkspaceId: 'workspace-b',
                cmsSiteId: 'site-b',
            },
        ],
        async (id) => {
            calls.push(id);
        },
        (error) => {
            throw error;
        },
    );
    assert.deepEqual(calls, ['operation-a', 'operation-b']);
});

test('staging is request-key idempotent and adoption verifies source state', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    const service = new MigrationService(h.runtime);
    const requestKey = randomUUID();
    const first = await service.stage({
        site: f.site,
        requestKey,
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: f.input,
    });
    const duplicate = await service.stage({
        site: f.site,
        requestKey,
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: f.input,
    });
    assert.equal(duplicate.id, first.id);
    await assert.rejects(
        () => service.adopt(first.id, `sha256:${'0'.repeat(64)}`, 'admin'),
        /source changed/i,
    );
    const newerSite = {
        ...f.site,
        updatedAt: f.site.updatedAt + 1,
    };
    h.setSite(newerSite);
    await assert.rejects(
        () => service.adopt(first.id, first.sourceChecksum, 'admin'),
        /site changed/i,
    );
    assert.equal(h.gatewayPublishCount(), 0);
});

test('candidate source exposes only namespaced templates and rewritten Entries', async () => {
    const f = fixture();
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: {
            ...f.input,
            entries: [
                {
                    ...f.entry,
                    meta: [
                        {
                            lng: 'en',
                            props: [...f.entry.meta[0].props],
                        },
                    ],
                },
            ],
        },
    });
    const base = {
        findSite: async () => f.site,
        loadContent: async () => {
            throw new Error('candidate source must override');
        },
        findRelease: async () => null,
        insertRelease: async () => undefined,
        activate: async () => true,
        audit: async () => undefined,
        saveSite: async () => true,
        projectGatewayRelease: async () => true,
    } satisfies GatewayReleaseSource;
    const source = createMigrationReleaseSource(operation, {
        base,
        update: async () => undefined,
    });
    const defaultSource = createMigrationReleaseSource(operation);
    const site = await source.findSite();
    assert.equal((await defaultSource.findSite())?._id, operation.cmsSiteId);
    const content = await source.loadContent(site!);
    assert.notEqual(site?.models[0].templateId, f.site.models[0].templateId);
    assert.equal(content.templates.length, 1);
    assert.equal(content.entries.length, 1);
    assert.equal(content.entries[0].templateId, site?.models[0].templateId);
    assert.ok(site?.templateNamespace?.includes('migration-'));
});

test('target blueprint changes replace matching route and model declarations', () => {
    const f = fixture();
    const changedManifest = structuredClone(manifest);
    changedManifest.pages[0] = {
        ...changedManifest.pages[0],
        title: 'Offerings',
        path: '/offerings',
    };
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: changedManifest,
        targetRecord: record,
        input: f.input,
    });
    assert.equal(operation.candidateSite.pages[0].title, 'Offerings');
    assert.equal(operation.candidateSite.pages[0].path, '/offerings');
});

test('candidate migration preserves every non-current translation', () => {
    const f = fixture();
    const translatedEntry = {
        ...f.entry,
        meta: [
            ...f.entry.meta,
            {
                lng: 'fr',
                props: [
                    {
                        id: 'prop-title',
                        data: ['Stratégie française'] as never,
                    },
                    {
                        id: 'prop-summary',
                        data: ['Résumé français'] as never,
                    },
                ],
            },
        ],
    };
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: {
            ...f.input,
            entries: [translatedEntry],
        },
    });
    const candidate = operation.candidateEntries?.[0];
    const french = candidate?.meta.find((meta) => meta.lng === 'fr');
    const titleProp = operation.candidateSite.models[0].fields.find(
        (field) => field.key === 'title',
    )?.propId;
    assert.deepEqual(
        french?.props.find((prop) => prop.id === titleProp)?.data,
        ['Stratégie française'],
    );
});

test('candidate rich content rewrites template and Entry pointers', () => {
    const f = fixture();
    const pointerEntry = {
        ...f.entry,
        content: [
            {
                lng: 'en',
                plainText: '',
                nodes: [
                    {
                        type: 'widget',
                        attrs: {
                            data: {
                                props: [
                                    {
                                        id: 'reference',
                                        data: [
                                            {
                                                tid: f.template._id,
                                                eid: f.entry._id,
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        ] as Entry['content'],
    };
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: { ...f.input, entries: [pointerEntry] },
    });
    const candidate = operation.candidateEntries?.[0];
    const reference = (
        candidate?.content[0]?.nodes[0]?.attrs as {
            data: {
                props: Array<{ data: Array<{ tid: string; eid: string }> }>;
            };
        }
    ).data.props[0].data[0];
    assert.equal(reference.tid, operation.candidateSite.models[0].templateId);
    assert.equal(reference.eid, candidate?._id);
    assert.notEqual(reference.tid, f.template._id);
    assert.notEqual(reference.eid, f.entry._id);
});

test('candidate source completes the existing Gateway publication protocol', async () => {
    const f = fixture();
    const currentSite: SiteInstallation = {
        ...f.site,
        gatewayCurrentReleaseId: undefined,
        gatewayPublishedReleaseIds: [],
        gatewayActiveRevision: undefined,
    };
    const operation = prepareMigrationOperation({
        site: currentSite,
        requestKey: randomUUID(),
        expectedUpdatedAt: currentSite.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: { ...f.input, site: currentSite },
    });
    const releases = new Map<string, ReleaseRecord>();
    const base = {
        findSite: async () => currentSite,
        loadContent: async () => {
            throw new Error('candidate source must override');
        },
        findRelease: async (id: string) => releases.get(id) || null,
        insertRelease: async (value: ReleaseRecord) => {
            releases.set(value._id, structuredClone(value));
        },
        activate: async () => true,
        audit: async () => undefined,
        saveSite: async () => true,
        projectGatewayRelease: async () => true,
    } satisfies GatewayReleaseSource;
    let current = structuredClone(operation);
    const source = createMigrationReleaseSource(operation, {
        base,
        update: async (value) => {
            current = structuredClone(value);
        },
    });
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.endsWith('/template-pin')) {
            return Response.json({
                ...record,
                templateId: record.id,
                templateVersion: record.version,
            });
        }
        if (target.endsWith('/publication-state')) {
            return Response.json({ revision: 3, active: null });
        }
        if (target.endsWith('/releases')) {
            return Response.json(
                { releaseId: JSON.parse(String(init?.body)).releaseId },
                { status: 201 },
            );
        }
        if (target.endsWith('/publish-operations')) {
            return Response.json(
                { id: 'operation-1', status: 'pending', revision: 4 },
                { status: 202 },
            );
        }
        throw new Error(`Unexpected Gateway URL ${target}`);
    };
    const result = await publishGatewayRelease(
        source,
        'admin',
        '',
        operation.requestKey,
        {
            gatewayBaseUrl: 'http://127.0.0.1:3001',
            workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            siteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            serviceSecret: 'test-secret',
            cmsWorkspaceId: 'workspace-1',
            cmsSiteId,
            siteUrl: 'https://site.example',
        },
        fetcher,
        () => ({
            schemaVersion: 1,
            siteId: cmsSiteId,
            language: 'en',
            pages: [],
            navigation: [],
            redirects: [],
        }),
    );
    assert.equal(result.status, 'pending');
    assert.ok(result.releaseId);
    assert.ok(releases.has(result.releaseId));
    assert.ok(current.candidateSite.gatewayPublishIntent);
    assert.match(
        current.candidateSite.presetManifestSnapshot || '',
        /"version":"1.0.1"/,
    );
});

test('a rejected Gateway candidate becomes failed without switching the site pointer', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    h.setGatewayState({ revision: 3, active: null });
    h.setPublishError(new Error('candidate_unhealthy'));
    const service = new MigrationService(h.runtime);
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: f.input,
    });
    await h.runtime.repository.save(operation);
    await assert.rejects(
        () => service.adopt(operation.id, operation.sourceChecksum, 'admin'),
        /candidate_unhealthy/,
    );
    const failed = await h.runtime.repository.find(operation.id);
    assert.equal(failed?.status, 'failed');
    assert.equal(h.site().presetVersion, '1.0.0');
});

test('adoption re-reads content checksum even when site updatedAt is unchanged', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    const service = new MigrationService(h.runtime);
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: f.input,
    });
    await h.runtime.repository.save(operation);
    h.setChecksumOverride(`sha256:${'f'.repeat(64)}`);
    await assert.rejects(
        () => service.adopt(operation.id, operation.sourceChecksum, 'admin'),
        /source changed/i,
    );
    assert.equal(h.gatewayPublishCount(), 0);
});

test('pending authoritative publication is reconciled and finalized exactly once', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    h.setGatewayState({ revision: 3, active: null });
    const service = new MigrationService(h.runtime);
    const operation = prepareMigrationOperation({
        site: f.site,
        requestKey: randomUUID(),
        expectedUpdatedAt: f.site.updatedAt,
        actorId: 'admin',
        targetManifest: manifest,
        targetRecord: record,
        input: f.input,
    });
    await h.runtime.repository.save(operation);
    const publishing = await service.adopt(
        operation.id,
        operation.sourceChecksum,
        'admin',
    );
    assert.equal(publishing.status, 'publishing');
    h.setGatewayState({
        revision: 4,
        active: {
            releaseId: 'release-new',
            imageDigest: record.imageDigest,
            routeRevision: 4,
            metadata: {},
            snapshot: {
                schemaVersion: 1,
                siteId: cmsSiteId,
                language: 'en',
                pages: [],
                navigation: [],
                redirects: [],
            },
            createdAt: new Date().toISOString(),
        },
    });
    const active = await service.reconcile(operation.id);
    assert.equal(active.status, 'active');
    const duplicate = await service.adopt(
        operation.id,
        operation.sourceChecksum,
        'admin',
    );
    assert.equal(duplicate.status, 'active');
    assert.equal(h.gatewayPublishCount(), 1);
    assert.equal(h.site().presetVersion, '1.0.1');
    assert.notEqual(h.site().models[0].templateId, f.site.models[0].templateId);
});

test('reconciliation restores only when Gateway proves the exact previous tuple', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    h.setGatewayState({
        revision: 3,
        active: {
            releaseId: 'release-old',
            imageDigest: record.imageDigest,
            routeRevision: 3,
            metadata: {},
            snapshot: {
                schemaVersion: 1,
                siteId: cmsSiteId,
                language: 'en',
                pages: [],
                navigation: [],
                redirects: [],
            },
            createdAt: new Date().toISOString(),
        },
    });
    const service = new MigrationService(h.runtime);
    const operation = {
        ...prepareMigrationOperation({
            site: f.site,
            requestKey: randomUUID(),
            expectedUpdatedAt: f.site.updatedAt,
            actorId: 'admin',
            targetManifest: manifest,
            targetRecord: record,
            input: f.input,
        }),
        status: 'publishing' as const,
        targetReleaseId: 'release-new',
        targetRouteRevision: 4,
    };
    await h.runtime.repository.save(operation);
    const failed = await service.reconcile(operation.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'gateway_rolled_back');
    assert.equal(h.site().presetVersion, '1.0.0');
});

test('rollback preserves a later draft before restoring the previous complete site', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    const service = new MigrationService(h.runtime);
    const operation = {
        ...prepareMigrationOperation({
            site: f.site,
            requestKey: randomUUID(),
            expectedUpdatedAt: f.site.updatedAt,
            actorId: 'admin',
            targetManifest: manifest,
            targetRecord: record,
            input: f.input,
        }),
        status: 'active' as const,
        targetReleaseId: 'release-new',
        targetRouteRevision: 4,
    };
    await h.runtime.repository.save(operation);
    h.setSite({
        ...operation.candidateSite,
        name: 'Later draft',
        updatedAt: operation.candidateSite.updatedAt + 5,
    });
    const rolledBack = await service.rollback(operation.id, 'admin');
    assert.equal(rolledBack.status, 'rolled-back');
    assert.equal(rolledBack.laterDraftSite?.name, 'Later draft');
    assert.equal(h.site().name, f.site.name);
    assert.equal(
        (await h.runtime.repository.find(operation.id))?.candidateEntries
            ?.length,
        1,
    );
});

test('model-scoped migration steps preserve conflicting multilingual fields', () => {
    const f = fixture();
    const target = structuredClone(manifest);
    target.models.push({
        key: 'team',
        label: 'Team',
        description: 'Team',
        singleEntry: false,
        fields: [
            {
                key: 'summary',
                label: 'Role',
                type: PropType.STRING,
                required: true,
                array: false,
            },
        ],
    });
    target.editor!.models.push({
        modelKey: 'team',
        fields: [
            { key: 'summary', label: 'Role', control: 'text', required: true },
        ],
    });
    target.compatibility!.migrations[0].steps = [
        {
            op: 'rename-field',
            model: 'team',
            from: 'alias',
            to: 'summary',
        },
    ];
    const teamTemplate: Template = {
        ...f.template,
        _id: 'template-team-old',
        name: 'team',
        props: [
            {
                ...f.template.props[0],
                id: 'prop-team-alias',
                name: 'alias',
                label: 'Role',
            },
        ],
    };
    const teamEntry: Entry = {
        ...f.entry,
        _id: 'team-entry',
        templateId: teamTemplate._id,
        meta: [
            {
                lng: 'en',
                props: [
                    {
                        id: 'prop-team-alias',
                        data: ['Guide'] as never,
                    },
                ],
            },
            {
                lng: 'fr',
                props: [
                    {
                        id: 'prop-team-alias',
                        data: ['Accompagnatrice'] as never,
                    },
                ],
            },
        ],
    };
    const translatedService = {
        ...f.entry,
        meta: [
            ...f.entry.meta,
            {
                lng: 'fr',
                props: [
                    {
                        id: 'prop-summary',
                        data: ['Résumé français'] as never,
                    },
                    {
                        id: 'prop-title',
                        data: ['Stratégie'] as never,
                    },
                ],
            },
        ],
    };
    const site: SiteInstallation = {
        ...f.site,
        models: [
            ...f.site.models,
            {
                key: 'team',
                templateId: teamTemplate._id,
                fields: [{ key: 'alias', propId: 'prop-team-alias' }],
            },
        ],
    };
    const operation = prepareMigrationOperation({
        site,
        requestKey: randomUUID(),
        expectedUpdatedAt: site.updatedAt,
        actorId: 'admin',
        targetManifest: target,
        targetRecord: record,
        steps: target.compatibility!.migrations[0].steps as never,
        input: {
            ...f.input,
            site,
            templates: [f.template, teamTemplate],
            entries: [translatedService, teamEntry],
        },
    });
    const service = operation.candidateEntries?.find(
        (entry) =>
            entry.meta.some((meta) => meta.lng === 'fr') &&
            entry.meta.some((meta) =>
                meta.props.some(
                    (prop) =>
                        Array.isArray(prop.data) &&
                        prop.data.includes('Résumé français' as never),
                ),
            ),
    );
    const team = operation.candidateEntries?.find(
        (entry) => entry._id !== service?._id,
    );
    const teamMapping = operation.candidateSite.models.find(
        (model) => model.key === 'team',
    )!;
    const teamSummary = teamMapping.fields.find(
        (field) => field.key === 'summary',
    )!.propId;
    assert.ok(
        service?.meta
            .find((meta) => meta.lng === 'fr')
            ?.props.some(
                (prop) =>
                    Array.isArray(prop.data) &&
                    prop.data.includes('Résumé français' as never),
            ),
    );
    assert.deepEqual(
        team?.meta
            .find((meta) => meta.lng === 'fr')
            ?.props.find((prop) => prop.id === teamSummary)?.data,
        ['Accompagnatrice'],
    );
});

test('rejects cross-template and undeclared structural migrations', () => {
    const f = fixture();
    const different = structuredClone(manifest);
    different.id = 'different-template';
    assert.throws(
        () =>
            prepareMigrationOperation({
                site: f.site,
                requestKey: randomUUID(),
                expectedUpdatedAt: f.site.updatedAt,
                actorId: 'admin',
                targetManifest: different,
                targetRecord: {
                    ...record,
                    id: different.id,
                    imageRepository:
                        'ghcr.io/tangtianshuo/independent-website-templates/different-template',
                    manifestPath:
                        'templates/different-template/1.0.1/template.json',
                },
                input: f.input,
            }),
        /same template id/i,
    );
    const noMigration = structuredClone(manifest);
    delete noMigration.compatibility;
    assert.throws(
        () =>
            prepareMigrationOperation({
                site: f.site,
                requestKey: randomUUID(),
                expectedUpdatedAt: f.site.updatedAt,
                actorId: 'admin',
                targetManifest: noMigration,
                targetRecord: record,
                input: f.input,
            }),
        /No migration is declared/i,
    );
    const removedField = structuredClone(manifest);
    removedField.models[0].fields = removedField.models[0].fields.filter(
        (field) => field.key !== 'summary',
    );
    removedField.editor!.models[0].fields =
        removedField.editor!.models[0].fields.filter(
            (field) => field.key !== 'summary',
        );
    assert.throws(
        () =>
            prepareMigrationOperation({
                site: f.site,
                requestKey: randomUUID(),
                expectedUpdatedAt: f.site.updatedAt,
                actorId: 'admin',
                targetManifest: removedField,
                targetRecord: record,
                input: f.input,
            }),
        /Unsupported structural migration/i,
    );
});

test('recovery settles a completed site CAS after operation persistence fails', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    const operation = {
        ...prepareMigrationOperation({
            site: f.site,
            requestKey: randomUUID(),
            expectedUpdatedAt: f.site.updatedAt,
            actorId: 'admin',
            targetManifest: manifest,
            targetRecord: record,
            input: f.input,
        }),
        targetReleaseId: 'release-new',
        targetRouteRevision: 4,
        recoveryPhase: 'gateway-active' as const,
    };
    await h.runtime.repository.save(operation);
    h.setGatewayState({
        revision: 4,
        active: {
            releaseId: 'release-new',
            imageDigest: record.imageDigest,
            routeRevision: 4,
            metadata: {},
            snapshot: {
                schemaVersion: 1,
                siteId: cmsSiteId,
                language: 'en',
                pages: [],
                navigation: [],
                redirects: [],
            },
            createdAt: new Date().toISOString(),
        },
    });
    let failActiveSave = true;
    const repository = {
        ...h.runtime.repository,
        save: async (value: MigrationOperation) => {
            if (failActiveSave && value.status === 'active') {
                throw new Error('simulated crash after site CAS');
            }
            await h.runtime.repository.save(value);
        },
    };
    const service = new MigrationService({ ...h.runtime, repository });
    await assert.rejects(
        () => service.adopt(operation.id, operation.sourceChecksum, 'admin'),
        /site CAS/,
    );
    assert.equal(h.site().migrationOperationId, operation.id);
    assert.equal(h.site().migrationState, 'active');
    failActiveSave = false;
    const settled = await service.reconcile(operation.id);
    assert.equal(settled.status, 'active');
    assert.equal(settled.recoveryPhase, 'settled');
});

test('recovery completes rollback after site restore succeeds but save fails', async () => {
    const f = fixture();
    const h = memoryRuntime();
    h.setSite(f.site);
    const operation = {
        ...prepareMigrationOperation({
            site: f.site,
            requestKey: randomUUID(),
            expectedUpdatedAt: f.site.updatedAt,
            actorId: 'admin',
            targetManifest: manifest,
            targetRecord: record,
            input: f.input,
        }),
        status: 'active' as const,
        recoveryPhase: 'settled' as const,
        targetReleaseId: 'release-new',
        targetRouteRevision: 4,
    };
    await h.runtime.repository.save(operation);
    h.setSite({
        ...operation.candidateSite,
        migrationState: 'active',
        migrationOperationId: operation.id,
        updatedAt: operation.candidateSite.updatedAt + 3,
    });
    h.setGatewayState({
        revision: 5,
        active: {
            releaseId: 'release-old',
            imageDigest: record.imageDigest,
            routeRevision: 3,
            metadata: {},
            snapshot: {
                schemaVersion: 1,
                siteId: cmsSiteId,
                language: 'en',
                pages: [],
                navigation: [],
                redirects: [],
            },
            createdAt: new Date().toISOString(),
        },
    });
    let failRolledBackSave = true;
    const repository = {
        ...h.runtime.repository,
        save: async (value: MigrationOperation) => {
            if (failRolledBackSave && value.status === 'rolled-back') {
                throw new Error('simulated crash after site restore');
            }
            await h.runtime.repository.save(value);
        },
    };
    const service = new MigrationService({ ...h.runtime, repository });
    await assert.rejects(
        () => service.rollback(operation.id, 'admin'),
        /site restore/,
    );
    assert.equal(h.site().migrationState, 'rolled-back');
    failRolledBackSave = false;
    const settled = await service.reconcile(operation.id);
    assert.equal(settled.status, 'rolled-back');
    assert.equal(settled.recoveryPhase, 'settled');
});
