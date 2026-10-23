import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import { type SiteInstallation, SiteInstallationSchema } from './site-model';

export const SiteInstallationRepo = createMongoDBRepository<SiteInstallation, {
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
            async findDefaultFresh() {
                return mdb.findOne({ slot: 'default' });
            },
            async saveDraft(site, expectedUpdatedAt) {
                const { currentReleaseId, publishedReleaseIds, ...draft } = site;
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
