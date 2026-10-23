import { ownerWorkspace } from '../workspaces/context';
import type { ReleaseRecord, ReleaseSnapshot } from '../presets/releases';
import type { SiteInstallation } from '../presets/site-model';

export async function publishedSite(host: string, expectedHost: string, source: {
    findSite(): Promise<SiteInstallation | null>;
    findRelease(id: string): Promise<ReleaseRecord | null>;
}): Promise<(ReleaseSnapshot & { releaseId: string }) | null> {
    if (host.toLowerCase() !== expectedHost.toLowerCase()) return null;
    const site = await source.findSite();
    if (!site?.currentReleaseId) return null;
    const release = await source.findRelease(site.currentReleaseId);
    if (!release || (release.siteId !== site._id || ownerWorkspace(release) !== ownerWorkspace(site))) return null;
    const snapshot = JSON.parse(release.payload) as ReleaseSnapshot;
    if (snapshot.schemaVersion !== 1 || (snapshot.siteId !== site._id || ownerWorkspace(snapshot) !== ownerWorkspace(site))) return null;
    return { ...snapshot, releaseId: release._id };
}

export async function publishedDomainSite(host: string, source: {
    resolve(host: string): Promise<import('../site-domains/model').DomainResolution | null>;
    findSiteById(id: string): Promise<SiteInstallation | null>;
    findRelease(id: string): Promise<ReleaseRecord | null>;
}): Promise<(ReleaseSnapshot & { releaseId: string; primaryHostname: string; bindingRevision: number }) | null> {
    const resolution = await source.resolve(host);
    if (!resolution) return null;
    const site = await source.findSiteById(resolution.siteId);
    if (!site?.currentReleaseId || (site._id !== resolution.siteId || ownerWorkspace(site) !== ownerWorkspace(resolution))) return null;
    const release = await source.findRelease(site.currentReleaseId);
    if (!release || (release.siteId !== site._id || ownerWorkspace(release) !== ownerWorkspace(site))) return null;
    let snapshot: ReleaseSnapshot;
    try { snapshot = JSON.parse(release.payload) as ReleaseSnapshot; } catch { return null; }
    if (snapshot.schemaVersion !== 1 || (snapshot.siteId !== site._id || ownerWorkspace(snapshot) !== ownerWorkspace(site))) return null;
    return { ...snapshot, releaseId: release._id, primaryHostname: resolution.primaryHostname, bindingRevision: resolution.bindingRevision };
}
