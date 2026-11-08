import { siteContext } from '../utils/site-context';
import { loadPublicSite } from '../utils/public-runtime.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const path = getQuery(event).path;
    if (
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.startsWith('//')
    ) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid page path',
        });
    }
    setHeader(event, 'Cache-Control', 'no-store');
    let page;
    try {
        page = await loadPublicSite({
            path,
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
        console.error('Published runtime read failed', {
            code: detail?.code,
            message: detail?.message,
        });
        throw createError({
            statusCode: 502,
            statusMessage: 'Published site unavailable',
        });
    }
    if (!page)
        throw createError({ statusCode: 404, statusMessage: 'Page not found' });
    return page;
});
