import { pinReleaseMedia } from '../media/retention';
import { ownerWorkspace } from '../workspaces/context';
import { Repo } from '../repo';
import type { ReleaseSnapshot } from './releases';
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { MongoDBEntrySchema } from '../_server/modules/mongodb/entry';
import { Config } from '../config';
import type { ReleaseRecord, ReleaseAudit } from './releases';

export const ReleaseRepo = createMongoDBRepository<ReleaseRecord, {
    findBySite(siteId: string): Promise<ReleaseRecord[]>;
    findRetainedMediaReference(id: string): Promise<{ workspaceId: string; siteId: string } | null>;
}>({
    name: 'StorefrontRelease',
    prepareWrite: (record) => pinReleaseMedia(record.payload, record._id),
    collection: `${Config.storageScope}_storefront_releases`,
    schema: { ...MongoDBEntrySchema,
        workspaceId: { __type: 'string', __required: false },
        siteId: { __type: 'string', __required: true },
        createdBy: { __type: 'string', __required: true },
        previousReleaseId: { __type: 'string', __required: true },
        payload: { __type: 'string', __required: true },
    },
    indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'release_history' }],
    methods({ mdb, identityCollection }) {
        return {
            async findRetainedMediaReference(id) {
                const segment = `/api/v4/media/${encodeURIComponent(id)}/bin/`;
                const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const records = identityCollection.find({ payload: { $regex: escaped } });
                for await (const record of records) {
                    const site = await Repo.siteInstallation.methods.findFresh(record.siteId);
                    if (!site || ownerWorkspace(site) !== ownerWorkspace(record) || !(site.publishedReleaseIds || [site.currentReleaseId]).includes(record._id)) continue;
                    let snapshot: ReleaseSnapshot;
                    try { snapshot = JSON.parse(record.payload); } catch { continue; }
                    if (snapshot.schemaVersion !== 1 || snapshot.siteId !== site._id || ownerWorkspace(snapshot) !== ownerWorkspace(record)) continue;
                    const contains = (value: unknown): boolean => {
                        if (typeof value === 'string') { try { const url = new URL(value); return url.pathname.startsWith(segment) && !url.searchParams.has('cap'); } catch { return false; } }
                        if (Array.isArray(value)) return value.some(contains);
                        return !!value && typeof value === 'object' && Object.values(value).some(contains);
                    };
                    if (contains(snapshot.pages)) return { workspaceId: ownerWorkspace(record), siteId: site._id };
                }
                return null;
            },
            async findBySite(siteId) { return mdb.find({ siteId }).sort({ createdAt: -1 }).toArray(); }
        };
    },
});

export const ReleaseAuditRepo = createMongoDBRepository<ReleaseAudit, {
    findBySite(siteId: string): Promise<ReleaseAudit[]>;
}>({
    name: 'StorefrontReleaseAudit',
    collection: `${Config.storageScope}_storefront_release_audit`,
    schema: { ...MongoDBEntrySchema,
        workspaceId: { __type: 'string', __required: false },
        siteId: { __type: 'string', __required: true },
        actorId: { __type: 'string', __required: true },
        operation: { __type: 'string', __required: true },
        releaseId: { __type: 'string', __required: true },
        error: { __type: 'string', __required: true },
    },
    indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'release_audit_history' }],
    methods({ mdb }) {
        return { async findBySite(siteId) { return mdb.find({ siteId }).sort({ createdAt: -1 }).limit(50).toArray(); } };
    },
});
