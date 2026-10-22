import { fetchProductPage } from '../../utils/catalog.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const slug = getRouterParam(event, 'slug') || '';
    const host = getRequestHost(event, { xForwardedHost: false });
    try {
        const page = await fetchProductPage({
            slug,
            host,
            expectedHost: config.public.siteHost,
            cmsOrigin: config.cmsInternalOrigin,
            fetcher: $fetch,
        });
        if (!page) {
            throw createError({ statusCode: 404, statusMessage: 'Product not found' });
        }
        setHeader(event, 'Cache-Control', 'no-store');
        return page;
    } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) {
            throw error;
        }
        throw createError({ statusCode: 502, statusMessage: 'Catalog unavailable' });
    }
});
