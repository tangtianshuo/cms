import type { MongoDBEntry } from '../_server/modules/mongodb';
import { MongoDBEntrySchema } from '../_server/modules/mongodb/entry';
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { Template } from '../template/models/main';
import type { SiteInstallation } from '../presets/site-model';
import type { MigrationStep } from './migration-preview';

export type MigrationOperationStatus =
    | 'planned'
    | 'staged'
    | 'publishing'
    | 'active'
    | 'failed'
    | 'rolled-back';

export interface MigrationOperation {
    id: string;
    cmsWorkspaceId: string;
    cmsSiteId: string;
    requestKey: string;
    expectedUpdatedAt: number;
    sourceChecksum: string;
    targetManifestChecksum: string;
    status: MigrationOperationStatus;
    previousSite: SiteInstallation;
    candidateSite: SiteInstallation;
    previousReleaseId: string;
    targetReleaseId?: string;
    targetRouteRevision?: number;
    errorCode?: string;
    actorId?: string;
    steps?: MigrationStep[];
    previousTemplates?: Template[];
    candidateTemplates?: Template[];
    previousEntries?: Entry[];
    candidateEntries?: Entry[];
    media?: Media[];
    laterDraftSite?: SiteInstallation;
    createdAt?: number;
    updatedAt?: number;
}

interface StoredMigrationOperation extends MongoDBEntry {
    cmsWorkspaceId: string;
    cmsSiteId: string;
    requestKey: string;
    expectedUpdatedAt: number;
    sourceChecksum: string;
    targetManifestChecksum: string;
    status: MigrationOperationStatus;
    previousSiteJson: string;
    candidateSiteJson: string;
    previousReleaseId: string;
    targetReleaseId?: string;
    targetRouteRevision?: number;
    errorCode?: string;
    actorId?: string;
    stepsJson?: string;
    previousTemplatesJson?: string;
    candidateTemplatesJson?: string;
    previousEntriesJson?: string;
    candidateEntriesJson?: string;
    mediaJson?: string;
    laterDraftSiteJson?: string;
}

function stored(operation: MigrationOperation): StoredMigrationOperation {
    const now = operation.updatedAt ?? Date.now();
    return {
        _id: operation.id,
        createdAt: operation.createdAt ?? now,
        updatedAt: now,
        cmsWorkspaceId: operation.cmsWorkspaceId,
        cmsSiteId: operation.cmsSiteId,
        requestKey: operation.requestKey,
        expectedUpdatedAt: operation.expectedUpdatedAt,
        sourceChecksum: operation.sourceChecksum,
        targetManifestChecksum: operation.targetManifestChecksum,
        status: operation.status,
        previousSiteJson: JSON.stringify(operation.previousSite),
        candidateSiteJson: JSON.stringify(operation.candidateSite),
        previousReleaseId: operation.previousReleaseId,
        ...(operation.targetReleaseId
            ? { targetReleaseId: operation.targetReleaseId }
            : {}),
        ...(operation.targetRouteRevision !== undefined
            ? { targetRouteRevision: operation.targetRouteRevision }
            : {}),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.actorId ? { actorId: operation.actorId } : {}),
        ...(operation.steps
            ? { stepsJson: JSON.stringify(operation.steps) }
            : {}),
        ...(operation.previousTemplates
            ? {
                  previousTemplatesJson: JSON.stringify(
                      operation.previousTemplates,
                  ),
              }
            : {}),
        ...(operation.candidateTemplates
            ? {
                  candidateTemplatesJson: JSON.stringify(
                      operation.candidateTemplates,
                  ),
              }
            : {}),
        ...(operation.previousEntries
            ? { previousEntriesJson: JSON.stringify(operation.previousEntries) }
            : {}),
        ...(operation.candidateEntries
            ? {
                  candidateEntriesJson: JSON.stringify(
                      operation.candidateEntries,
                  ),
              }
            : {}),
        ...(operation.media
            ? { mediaJson: JSON.stringify(operation.media) }
            : {}),
        ...(operation.laterDraftSite
            ? { laterDraftSiteJson: JSON.stringify(operation.laterDraftSite) }
            : {}),
    };
}

function parsed(value?: string): unknown {
    return value ? JSON.parse(value) : undefined;
}

function migrationOperation(
    record: StoredMigrationOperation,
): MigrationOperation {
    return {
        id: record._id,
        cmsWorkspaceId: record.cmsWorkspaceId,
        cmsSiteId: record.cmsSiteId,
        requestKey: record.requestKey,
        expectedUpdatedAt: record.expectedUpdatedAt,
        sourceChecksum: record.sourceChecksum,
        targetManifestChecksum: record.targetManifestChecksum,
        status: record.status,
        previousSite: JSON.parse(record.previousSiteJson),
        candidateSite: JSON.parse(record.candidateSiteJson),
        previousReleaseId: record.previousReleaseId,
        ...(record.targetReleaseId
            ? { targetReleaseId: record.targetReleaseId }
            : {}),
        ...(record.targetRouteRevision !== undefined
            ? { targetRouteRevision: record.targetRouteRevision }
            : {}),
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        ...(record.actorId ? { actorId: record.actorId } : {}),
        ...(record.stepsJson
            ? { steps: parsed(record.stepsJson) as MigrationStep[] }
            : {}),
        ...(record.previousTemplatesJson
            ? {
                  previousTemplates: parsed(
                      record.previousTemplatesJson,
                  ) as Template[],
              }
            : {}),
        ...(record.candidateTemplatesJson
            ? {
                  candidateTemplates: parsed(
                      record.candidateTemplatesJson,
                  ) as Template[],
              }
            : {}),
        ...(record.previousEntriesJson
            ? {
                  previousEntries: parsed(
                      record.previousEntriesJson,
                  ) as Entry[],
              }
            : {}),
        ...(record.candidateEntriesJson
            ? {
                  candidateEntries: parsed(
                      record.candidateEntriesJson,
                  ) as Entry[],
              }
            : {}),
        ...(record.mediaJson
            ? { media: parsed(record.mediaJson) as Media[] }
            : {}),
        ...(record.laterDraftSiteJson
            ? {
                  laterDraftSite: parsed(
                      record.laterDraftSiteJson,
                  ) as SiteInstallation,
              }
            : {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

export interface MigrationRepository {
    save(operation: MigrationOperation): Promise<void>;
    find(id: string): Promise<MigrationOperation | null>;
    findByRequestKey(
        workspaceId: string,
        siteId: string,
        requestKey: string,
    ): Promise<MigrationOperation | null>;
    listBySite(siteId: string): Promise<MigrationOperation[]>;
    listByStatus(
        status: MigrationOperationStatus,
    ): Promise<MigrationOperation[]>;
}

const RawMigrationRepo = createMongoDBRepository<
    StoredMigrationOperation,
    {
        findByRequestKey(
            workspaceId: string,
            siteId: string,
            requestKey: string,
        ): Promise<StoredMigrationOperation | null>;
        listBySite(siteId: string): Promise<StoredMigrationOperation[]>;
        listByStatus(
            status: MigrationOperationStatus,
        ): Promise<StoredMigrationOperation[]>;
    }
>({
    name: 'MigrationOperation',
    collection: `${Config.storageScope}_template_migration_operations`,
    schema: {
        ...MongoDBEntrySchema,
        cmsWorkspaceId: { __type: 'string', __required: true },
        cmsSiteId: { __type: 'string', __required: true },
        requestKey: { __type: 'string', __required: true },
        expectedUpdatedAt: { __type: 'number', __required: true },
        sourceChecksum: { __type: 'string', __required: true },
        targetManifestChecksum: { __type: 'string', __required: true },
        status: { __type: 'string', __required: true },
        previousSiteJson: { __type: 'string', __required: true },
        candidateSiteJson: { __type: 'string', __required: true },
        previousReleaseId: { __type: 'string', __required: true },
        targetReleaseId: { __type: 'string', __required: false },
        targetRouteRevision: { __type: 'number', __required: false },
        errorCode: { __type: 'string', __required: false },
        actorId: { __type: 'string', __required: false },
        stepsJson: { __type: 'string', __required: false },
        previousTemplatesJson: { __type: 'string', __required: false },
        candidateTemplatesJson: { __type: 'string', __required: false },
        previousEntriesJson: { __type: 'string', __required: false },
        candidateEntriesJson: { __type: 'string', __required: false },
        mediaJson: { __type: 'string', __required: false },
        laterDraftSiteJson: { __type: 'string', __required: false },
    },
    indexes: [
        {
            key: { cmsWorkspaceId: 1, cmsSiteId: 1, requestKey: 1 },
            name: 'migration_request_unique',
            unique: true,
        },
        {
            key: { cmsSiteId: 1, createdAt: -1 },
            name: 'migration_site_history',
        },
    ],
    methods({ mdb }) {
        return {
            async findByRequestKey(workspaceId, siteId, requestKey) {
                return mdb.findOne({
                    cmsWorkspaceId: workspaceId,
                    cmsSiteId: siteId,
                    requestKey,
                });
            },
            async listBySite(siteId) {
                return mdb
                    .find({ cmsSiteId: siteId })
                    .sort({ createdAt: -1 })
                    .toArray();
            },
            async listByStatus(status) {
                return mdb.find({ status }).toArray();
            },
        };
    },
});

export const TemplateMigrationOperationRepo = RawMigrationRepo;

export function initMigrationRepository(fastify: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        RawMigrationRepo.init().initialize({
            fastify,
            next: (error?: Error) => (error ? reject(error) : resolve()),
        } as never);
    });
}

export function mongoMigrationRepository(): MigrationRepository {
    return {
        async save(value) {
            const record = stored(value);
            const existing = await RawMigrationRepo.findById(record._id);
            if (existing) await RawMigrationRepo.update(record, false);
            else await RawMigrationRepo.add(record, true);
        },
        async find(id) {
            const record = await RawMigrationRepo.findById(id);
            return record ? migrationOperation(record) : null;
        },
        async findByRequestKey(workspaceId, siteId, requestKey) {
            const record = await RawMigrationRepo.methods.findByRequestKey(
                workspaceId,
                siteId,
                requestKey,
            );
            return record ? migrationOperation(record) : null;
        },
        async listBySite(siteId) {
            return (await RawMigrationRepo.methods.listBySite(siteId)).map(
                migrationOperation,
            );
        },
        async listByStatus(status) {
            return (await RawMigrationRepo.methods.listByStatus(status)).map(
                migrationOperation,
            );
        },
    };
}

export function createMemoryMigrationRepository(): MigrationRepository {
    const values = new Map<string, MigrationOperation>();
    const clone = (value: MigrationOperation) => structuredClone(value);
    return {
        async save(value) {
            values.set(value.id, clone(value));
        },
        async find(id) {
            const value = values.get(id);
            return value ? clone(value) : null;
        },
        async findByRequestKey(workspaceId, siteId, requestKey) {
            const value = [...values.values()].find(
                (item) =>
                    item.cmsWorkspaceId === workspaceId &&
                    item.cmsSiteId === siteId &&
                    item.requestKey === requestKey,
            );
            return value ? clone(value) : null;
        },
        async listBySite(siteId) {
            return [...values.values()]
                .filter((item) => item.cmsSiteId === siteId)
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .map(clone);
        },
        async listByStatus(status) {
            return [...values.values()]
                .filter((item) => item.status === status)
                .map(clone);
        },
    };
}
