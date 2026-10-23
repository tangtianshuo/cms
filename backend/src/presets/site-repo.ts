import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import { type SiteInstallation, SiteInstallationSchema } from './site-model';

export const SiteInstallationRepo = createMongoDBRepository<SiteInstallation, {
    findDefault(): Promise<SiteInstallation | null>;
}>({
    name: 'SiteInstallation',
    collection: `${Config.storageScope}_site_installations`,
    schema: SiteInstallationSchema,
    indexes: [{ key: { slot: 1 }, name: 'site_slot_unique', unique: true }],
    methods({ mdb, cache }) {
        return {
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
