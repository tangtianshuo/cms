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
    if (!release || release.siteId !== site._id) return null;
    const snapshot = JSON.parse(release.payload) as ReleaseSnapshot;
    if (snapshot.schemaVersion !== 1 || snapshot.siteId !== site._id) return null;
    return { ...snapshot, releaseId: release._id };
}
