import { fetchPublishedSite } from './release.mjs';
import {
    readRuntimeRelease,
    readRuntimeReleaseForMode,
    RuntimeReleaseError,
} from './runtime-release.mjs';
import { resolveRuntimePublishedPage } from './runtime-page.mjs';

export async function loadPublicSite({
    runtimeMode,
    artifactRoot,
    releaseId,
    host,
    path,
    legacyCmsPublicRead = false,
    expectedHost,
    gatewaySecret,
    cmsOrigin,
    fetcher,
}) {
    if (runtimeMode === 'artifact') {
        const release = await readRuntimeReleaseForMode({
            runtimeMode,
            artifactRoot,
            releaseId,
            siteHost: host,
        });
        if (path === undefined)
            return { ...release.snapshot, releaseId: release.releaseId };
        return resolveRuntimePublishedPage(release, path);
    }
    if (runtimeMode === 'legacy' && !legacyCmsPublicRead) {
        throw new RuntimeReleaseError(
            'legacy_runtime_disabled',
            'Legacy CMS runtime is explicitly disabled',
        );
    }
    if (artifactRoot) {
        const release = await readRuntimeRelease({
            artifactRoot,
            siteHost: host,
            releaseId,
        });
        if (path === undefined)
            return { ...release.snapshot, releaseId: release.releaseId };
        return resolveRuntimePublishedPage(release, path);
    }
    if (!legacyCmsPublicRead) {
        throw new RuntimeReleaseError(
            'runtime_unconfigured',
            'Public runtime artifact is not configured',
        );
    }
    return fetchPublishedSite({
        host,
        expectedHost,
        gatewaySecret,
        cmsOrigin,
        path,
        fetcher,
    });
}
