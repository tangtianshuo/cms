export async function fetchPublishedSite({ host, expectedHost, cmsOrigin, path, fetcher }) {
    if (host.toLowerCase() !== expectedHost.toLowerCase()) return null;
    const query = path === undefined ? '' : `?${new URLSearchParams({ path })}`;
    try {
        return await fetcher(`${cmsOrigin.replace(/\/$/, '')}/api/v4/storefront/published${query}`,
            { headers: { 'x-storefront-host': host } });
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
