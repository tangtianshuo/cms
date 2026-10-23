import { fetchPublishedSite } from '../utils/release.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const path = getQuery(event).path;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid page path' });
    }
    setHeader(event, 'Cache-Control', 'no-store');
    let page;
    try {
        page = await fetchPublishedSite({ path,
            host: getRequestHost(event, { xForwardedHost: false }), expectedHost: config.public.siteHost,
            cmsOrigin: config.cmsInternalOrigin, fetcher: $fetch });
    } catch {
        throw createError({ statusCode: 502, statusMessage: 'Published site unavailable' });
    }
    if (!page) throw createError({ statusCode: 404, statusMessage: 'Page not found' });
    return page;
});
