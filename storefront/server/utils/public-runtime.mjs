import { fetchPublishedSite } from './release.mjs';
import { readRuntimeRelease, RuntimeReleaseError } from './runtime-release.mjs';
import { resolveRuntimePublishedPage } from './runtime-page.mjs';

export async function loadPublicSite({ artifactRoot, releaseId, host, path, legacyCmsPublicRead = false,
    expectedHost, gatewaySecret, cmsOrigin, fetcher }) {
    if (artifactRoot) {
        const release = await readRuntimeRelease({ artifactRoot, siteHost: host, releaseId });
        if (path === undefined) return { ...release.snapshot, releaseId: release.releaseId };
        return resolveRuntimePublishedPage(release, path);
    }
    if (!legacyCmsPublicRead) {
        throw new RuntimeReleaseError('runtime_unconfigured', 'Public runtime artifact is not configured');
    }
    return fetchPublishedSite({ host, expectedHost, gatewaySecret, cmsOrigin, path, fetcher });
}
