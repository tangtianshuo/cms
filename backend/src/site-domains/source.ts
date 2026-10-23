import { Config } from '../config';
import { Repo } from '../repo';
import { DomainService, type DomainSource } from './service';
// The event remains in the site's durable outbox until its idempotent audit
// projection is acknowledged. An unavailable projection never reverses a commit.
export async function flushDomainAudits(siteId: string): Promise<void> {
    try {
        for (const event of await Repo.siteInstallation.methods.pendingDomainAudits(siteId)) {
            await Repo.siteDomainAudit.methods.record(event);
            await Repo.siteInstallation.methods.acknowledgeDomainAudit(siteId, event._id);
        }
    } catch (error) { console.error('Domain primary audit projection deferred; durable event retained', error); }
}
export function domainSource(): DomainSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findDefaultFresh(),
        findSiteById: (id) => Repo.siteInstallation.methods.findFresh(id),
        async list(id) { await flushDomainAudits(id); return Repo.siteDomain.methods.list(id); },
        findHost: (host) => Repo.siteDomain.methods.findHost(host),
        findId: (id) => Repo.siteDomain.methods.findId(id),
        async insert(record) { await Repo.siteDomain.add(record, true); },
        replace: (record, expected) => Repo.siteDomain.methods.replace(record, expected),
        async remove(id, expected) { if (!await Repo.siteDomain.methods.remove(id, expected)) throw new Error('Domain changed; reload'); },
        async setPrimary(site, id, audit) { await Repo.siteInstallation.methods.setPrimaryDomain(site._id, id, audit); await flushDomainAudits(site._id); },
        touch: (id) => Repo.siteInstallation.methods.touchDomains(id),
        async audit(event) { await Repo.siteDomainAudit.add(event, true); },
        withSiteLock: (siteId, action) => Repo.siteInstallation.methods.withDomainLock(siteId, action),
    };
}
export function domainService() {
    return new DomainService(domainSource(), { secret: Config.storefrontDomainSecret,
        entryHost: Config.storefrontEntryHost, entryIp: Config.storefrontEntryIp, localHost: Config.storefrontHost });
}
