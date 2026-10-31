export function publishedSiteUrl(site: { bound: boolean; siteUrl: string; publicHostname?: string; defaultHost?: string } | null, fallbackOrigin: string): string {
    if (!site) return '';
    try {
        const value = site.bound ? site.siteUrl : site.publicHostname
            ? site.publicHostname === site.defaultHost ? fallbackOrigin : `https://${site.publicHostname}` : '';
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}
