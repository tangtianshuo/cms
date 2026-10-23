import { createMongoDBRepository } from '../_server/modules/mongodb';
import { MongoDBEntrySchema } from '../_server/modules/mongodb/entry';
import { Config } from '../config';
import type { DomainAudit, SiteDomain } from './model';

const strings = ['siteId', 'hostname', 'ownershipStatus', 'connectionStatus', 'verificationTokenHash', 'lastError'];
const numbers = ['verificationExpiresAt', 'verifiedAt', 'lastCheckedAt', 'lastSuccessAt'];
export const SiteDomainRepo = createMongoDBRepository<SiteDomain, {
    list(siteId: string): Promise<SiteDomain[]>;
    findHost(hostname: string): Promise<SiteDomain | null>;
    findId(id: string): Promise<SiteDomain | null>;
    replace(record: SiteDomain, expectedUpdatedAt: number): Promise<boolean>;
    remove(id: string, expectedUpdatedAt: number): Promise<boolean>;
    cleanupExpired(): Promise<number>;
}>({
    name: 'SiteDomain', collection: `${Config.storageScope}_site_domains`,
    schema: { ...MongoDBEntrySchema,
        ...Object.fromEntries(strings.map((key) => [key, { __type: 'string', __required: true }])),
        ...Object.fromEntries(numbers.map((key) => [key, { __type: 'number', __required: true }])),
        enabled: { __type: 'boolean', __required: true }, dnsReady: { __type: 'boolean', __required: true } },
    indexes: [{ key: { hostname: 1 }, name: 'domain_hostname_unique', unique: true }, { key: { siteId: 1 }, name: 'domains_by_site' }],
    methods({ mdb, cache }) {
        return {
            async list(siteId) { return mdb.find({ siteId }).sort({ createdAt: 1 }).toArray(); },
            async findHost(hostname) { return mdb.findOne({ hostname }); },
            async findId(_id) { return mdb.findOne({ _id }); },
            async replace(record, expectedUpdatedAt) {
                const result = await mdb.updateOne({ _id: record._id, siteId: record.siteId, updatedAt: expectedUpdatedAt }, { $set: record });
                cache.remove(record._id); return result.matchedCount === 1;
            },
            async remove(_id, updatedAt) { const result = await mdb.deleteOne({ _id, updatedAt }); cache.remove(_id); return result.deletedCount === 1; },
            async cleanupExpired() {
                // Keep expired rows for seven days to show actionable errors before releasing the hostname.
                const result = await mdb.deleteMany({ ownershipStatus: 'pending', verificationExpiresAt: { $lt: Date.now() - 7 * 86400000 } });
                cache.remove(cache.items.map((item) => item._id)); return result.deletedCount;
            },
        };
    },
});
export const SiteDomainAuditRepo = createMongoDBRepository<DomainAudit, { record(event: DomainAudit): Promise<void> }>({
    name: 'SiteDomainAudit', collection: `${Config.storageScope}_site_domain_audit`,
    schema: { ...MongoDBEntrySchema, ...Object.fromEntries(['siteId', 'domainId', 'actorId', 'operation', 'error'].map((key) => [key, { __type: 'string', __required: true }])) },
    indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'domain_audit_history' }],
    methods({ mdb }) { return { async record(event) { await mdb.updateOne({ _id: event._id }, { $setOnInsert: event }, { upsert: true }); } }; },
});
