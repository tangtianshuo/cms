import { Config } from '../config';
import { Repo } from '../repo';
import { DomainService, type DomainSource } from './service';
export function domainSource(): DomainSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findDefaultFresh(),
        findSiteById: (id) => Repo.siteInstallation.methods.findFresh(id),
        list: (id) => Repo.siteDomain.methods.list(id),
        findHost: (host) => Repo.siteDomain.methods.findHost(host),
        findId: (id) => Repo.siteDomain.methods.findId(id),
        async insert(record) { await Repo.siteDomain.add(record, true); },
        replace: (record, expected) => Repo.siteDomain.methods.replace(record, expected),
        async remove(id, expected) { if (!await Repo.siteDomain.methods.remove(id, expected)) throw new Error('Domain changed; reload'); },
        setPrimary: (site, id) => Repo.siteInstallation.methods.setPrimaryDomain(site._id, id),
        touch: (id) => Repo.siteInstallation.methods.touchDomains(id),
        async audit(event) { await Repo.siteDomainAudit.add(event, true); },
        withSiteLock: (siteId, action) => Repo.siteInstallation.methods.withDomainLock(siteId, action),
    };
}
export function domainService() {
    return new DomainService(domainSource(), { secret: Config.storefrontDomainSecret,
        entryHost: Config.storefrontEntryHost, entryIp: Config.storefrontEntryIp, localHost: Config.storefrontHost });
}
