import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const domainLock = new AsyncLocalStorage<{ siteId: string; token: string }>();
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import { type SiteInstallation, SiteInstallationSchema } from './site-model';

export const SiteInstallationRepo = createMongoDBRepository<SiteInstallation, {
    findFresh(id: string): Promise<SiteInstallation | null>;
    withDomainLock<T>(siteId: string, action: () => Promise<T>): Promise<T>;
    setPrimaryDomain(siteId: string, id: string): Promise<void>;
    touchDomains(siteId: string): Promise<void>;
    findDefault(): Promise<SiteInstallation | null>;
    findDefaultFresh(): Promise<SiteInstallation | null>;
    saveDraft(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
    activate(site: SiteInstallation, releaseId: string): Promise<boolean>;
}>({
    name: 'SiteInstallation',
    collection: `${Config.storageScope}_site_installations`,
    schema: SiteInstallationSchema,
    indexes: [{ key: { slot: 1 }, name: 'site_slot_unique', unique: true }],
    methods({ mdb, cache }) {
        return {
            async findFresh(_id) { return mdb.findOne({ _id }); },
            async withDomainLock(siteId, action) {
                const token = randomUUID();
                const now = Date.now();
                const result = await mdb.updateOne({ _id: siteId, $or: [{ domainMutationUntil: { $exists: false } }, { domainMutationUntil: { $lt: now } }] },
                    { $set: { domainMutationToken: token, domainMutationUntil: now + 30000 } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                try { return await domainLock.run({ siteId, token }, action); }
                finally { await mdb.updateOne({ _id: siteId, domainMutationToken: token }, { $unset: { domainMutationToken: '', domainMutationUntil: '' } }); cache.remove(siteId); }
            },
            async setPrimaryDomain(siteId, id) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId) throw new Error('Domain changed; reload');
                const result = await mdb.updateOne({ _id: siteId, domainMutationToken: lock.token, domainMutationUntil: { $gt: Date.now() } }, { $set: { primaryDomainId: id }, $inc: { domainRevision: 1 } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async touchDomains(siteId) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId) throw new Error('Domain changed; reload');
                const result = await mdb.updateOne({ _id: siteId, domainMutationToken: lock.token, domainMutationUntil: { $gt: Date.now() } }, { $inc: { domainRevision: 1 } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async findDefaultFresh() {
                return mdb.findOne({ slot: 'default' });
            },
            async saveDraft(site, expectedUpdatedAt) {
                const { currentReleaseId, publishedReleaseIds, primaryDomainId, domainRevision, domainMutationToken, domainMutationUntil, ...draft } = site;
                const result = await mdb.updateOne({ _id: site._id, updatedAt: expectedUpdatedAt }, {
                    $set: { ...draft, updatedAt: Math.max(Date.now(), expectedUpdatedAt + 1) },
                });
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async activate(site, releaseId) {
                const result = await mdb.updateOne({ _id: site._id, updatedAt: site.updatedAt,
                    currentReleaseId: site.currentReleaseId || { $exists: false } }, {
                    $set: { currentReleaseId: releaseId, updatedAt: Math.max(Date.now(), site.updatedAt + 1) },
                    $addToSet: { publishedReleaseIds: releaseId },
                });
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async findDefault() {
                const cached = cache.find((item) => item.slot === 'default');
                if (cached) return cached;
                const site = await mdb.findOne({ slot: 'default' });
                if (site) cache.set(site);
                return site;
            },
        };
    },
});
