export async function fetchProductPage({ slug, host, expectedHost, cmsOrigin, fetcher }) {
    if (!slug || host.toLowerCase() !== expectedHost.toLowerCase()) {
        return null;
    }
    try {
        return await fetcher(
            `${cmsOrigin.replace(/\/$/, '')}/api/v4/storefront/products/${encodeURIComponent(slug)}`,
            { headers: { 'x-storefront-host': host } },
        );
    } catch (error) {
        if (error?.statusCode === 404 || error?.status === 404 || error?.response?.status === 404) {
            return null;
        }
        throw error;
    }
}
