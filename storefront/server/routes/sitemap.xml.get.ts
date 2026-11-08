import { siteContext } from '../utils/site-context';
import { sitemapXml } from '../utils/release.mjs';
import { loadPublicSite } from '../utils/public-runtime.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    setHeader(event, 'Cache-Control', 'no-store');
    let site;
    try {
        site = await loadPublicSite({
            path: undefined,
            host: siteContext(event),
            expectedHost: config.public.siteHost,
            gatewaySecret: config.gatewaySecret,
            cmsOrigin: config.cmsInternalOrigin,
            fetcher: $fetch,
            artifactRoot: config.runtimeArtifactRoot,
            releaseId: config.runtimeReleaseId,
            runtimeMode: config.runtimeMode,
            legacyCmsPublicRead: config.legacyCmsPublicRead,
        });
    } catch (error) {
        const detail = error as { code?: unknown; message?: unknown };
        console.error('Published sitemap read failed', {
            code: detail?.code,
            message: detail?.message,
        });
        throw createError({
            statusCode: 502,
            statusMessage: 'Published site unavailable',
        });
    }
    if (!site)
        throw createError({
            statusCode: 404,
            statusMessage: 'Site not published',
        });
    setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
    return sitemapXml(site.paths, site.origin);
});
