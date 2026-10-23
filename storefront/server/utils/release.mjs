import { domainToASCII } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
export async function fetchPublishedSite({ host, expectedHost, gatewaySecret, cmsOrigin, path, fetcher }) {
    if (!gatewaySecret && host.toLowerCase() !== expectedHost?.toLowerCase()) return null;
    const query = path === undefined ? '' : `?${new URLSearchParams({ path })}`;
    try {
        return await fetcher(`${cmsOrigin.replace(/\/$/, '')}/api/v4/storefront/published${query}`,
            { headers: { 'x-storefront-host': host, ...(gatewaySecret ? { 'x-storefront-key': gatewaySecret } : {}) } });
    } catch (error) {
        if (error?.statusCode === 404 || error?.status === 404 || error?.response?.status === 404) return null;
        throw error;
    }
}

export function sitemapXml(paths, origin) {
    const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        paths.map((path) => `<url><loc>${escape(new URL(path, origin).href)}</loc></url>`).join('') + '</urlset>';
}

function domain(host) {
    if (typeof host !== 'string' || /[\s/:@*\\?#%]/.test(host)) return null;
    const ascii = domainToASCII(host.replace(/\.$/, '')).toLowerCase();
    if (!ascii.includes('.') || ascii.length > 253 || /^\d+(?:\.\d+){3}$/.test(ascii) || ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return ascii;
}
export function trustedGatewayHost({ host, forwardedHost, key, secret, expectedHost, production }) {
    if (!production && host === expectedHost && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return host;
    if (!secret || typeof key !== 'string' || Buffer.byteLength(key) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(key), Buffer.from(secret))) return null;
    const hostname = domain(host);
    return hostname && hostname === domain(forwardedHost) ? hostname : null;
}
export function aliasRedirect(hostname, primaryHostname, path) {
    if (hostname === primaryHostname || !domain(primaryHostname) || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path) || /^\/(?:%2f|%5c)/i.test(path)) return null;
    return `https://${domain(primaryHostname)}${path}`;
}
