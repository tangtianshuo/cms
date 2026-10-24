import { fetchPublishedSite, aliasRedirect } from '../utils/release.mjs';
import { siteContext } from '../utils/site-context';
export default defineEventHandler(async (event) => {
    const path = event.path;
    if (path.startsWith('/_nuxt/') || path.startsWith('/presets/') || path.startsWith('/api/presets/') || path.split('?')[0] === '/preview') return;
    setHeader(event, 'Cache-Control', 'no-store');
    const host = siteContext(event);
    if (path.startsWith('/api/') || path.startsWith('/.well-known/')) return;
    const config = useRuntimeConfig(event);
    let site;
    try { site = await fetchPublishedSite({ host, expectedHost: config.public.siteHost,
        gatewaySecret: config.gatewaySecret, cmsOrigin: config.cmsInternalOrigin, path: undefined, fetcher: $fetch }); }
    catch { throw createError({ statusCode: 502, statusMessage: 'Published site unavailable' }); }
    if (!site) throw createError({ statusCode: 404, statusMessage: 'Site not published' });
    const redirect = aliasRedirect(host, site.primaryHostname, path);
    if (redirect) return sendRedirect(event, redirect, 301);
});
