import { fetchPresetDemo } from '../../utils/preset.mjs';

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, 'id') || '';
    const config = useRuntimeConfig(event);
    let preset;
    try {
        preset = await fetchPresetDemo({ id, cmsOrigin: config.cmsInternalOrigin, fetcher: $fetch });
    } catch {
        throw createError({ statusCode: 502, statusMessage: 'Preset catalog unavailable' });
    }
    if (!preset) throw createError({ statusCode: 404, statusMessage: 'Preset not found' });
    setHeader(event, 'Cache-Control', 'public, max-age=300');
    return preset;
});
