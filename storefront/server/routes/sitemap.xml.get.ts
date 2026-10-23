import { fetchPublishedSite, sitemapXml } from '../utils/release.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    setHeader(event, 'Cache-Control', 'no-store');
    let site;
    try {
        site = await fetchPublishedSite({
            path: undefined,
            host: getRequestHost(event, { xForwardedHost: false }), expectedHost: config.public.siteHost,
            cmsOrigin: config.cmsInternalOrigin, fetcher: $fetch });
    } catch {
        throw createError({ statusCode: 502, statusMessage: 'Published site unavailable' });
    }
    if (!site) throw createError({ statusCode: 404, statusMessage: 'Site not published' });
    setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
    return sitemapXml(site.paths, getRequestURL(event).origin);
});
