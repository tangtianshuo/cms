import { createMongoDBRepository } from '../_server/modules/mongodb';
import { MongoDBEntrySchema } from '../_server/modules/mongodb/entry';
import { Config } from '../config';
import type { ReleaseRecord, ReleaseAudit } from './releases';

export const ReleaseRepo = createMongoDBRepository<ReleaseRecord, {
    findBySite(siteId: string): Promise<ReleaseRecord[]>;
}>({
    name: 'StorefrontRelease',
    collection: `${Config.storageScope}_storefront_releases`,
    schema: { ...MongoDBEntrySchema,
        workspaceId: { __type: 'string', __required: false },
        siteId: { __type: 'string', __required: true },
        createdBy: { __type: 'string', __required: true },
        previousReleaseId: { __type: 'string', __required: true },
        payload: { __type: 'string', __required: true },
    },
    indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'release_history' }],
    methods({ mdb }) {
        return { async findBySite(siteId) { return mdb.find({ siteId }).sort({ createdAt: -1 }).toArray(); } };
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
