export function presetView(value) {
    if (value === undefined || value === '') return 'home';
    return ['home', 'collection', 'product', 'page'].includes(value) ? value : null;
}

export async function fetchPresetDemo({ id, cmsOrigin, fetcher }) {
    if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
    try {
        return await fetcher(`${cmsOrigin.replace(/\/$/, '')}/api/v4/presets/catalog/${encodeURIComponent(id)}`);
    } catch (error) {
        if (error?.statusCode === 404 || error?.status === 404 || error?.response?.status === 404) return null;
        throw error;
    }
}
