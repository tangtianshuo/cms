const sectionsByView = {
    home: ['hero', 'feature'],
    collection: ['heading', 'grid'],
    product: ['gallery', 'information', 'description'],
    page: ['story'],
};

function strings(object, keys) {
    return Boolean(object && typeof object === 'object' &&
        keys.every((key) => typeof object[key] === 'string'));
}

export function isPresetPreviewPayload(value) {
    if (!value || typeof value !== 'object' || value.kind !== 'preset-page' ||
        !Object.hasOwn(sectionsByView, value.view)) return false;
    if (!Array.isArray(value.sections) || value.sections.some((section) =>
        typeof section !== 'string' || !sectionsByView[value.view].includes(section))) return false;
    if (!strings(value.seo, ['title', 'description'])) return false;
    const preset = value.preset;
    if (!strings(preset, ['id', 'version', 'name', 'description']) ||
        !strings(preset.theme, ['background', 'foreground', 'accent', 'muted', 'font'])) return false;
    const demo = preset.demo;
    return strings(demo, ['brand']) &&
        strings(demo.hero, ['title', 'subtitle', 'image']) &&
        strings(demo.collection, ['title', 'description', 'image']) &&
        strings(demo.product, ['title', 'price', 'description', 'image']) &&
        strings(demo.page, ['title', 'body', 'image']);
}

export function isSiteDraftPreviewPayload(value) {
    if (!value || typeof value !== 'object' || value.kind !== 'preset-site' ||
        value.schemaVersion !== 1 || !strings(value, ['siteId', 'siteName', 'language']) ||
        !Array.isArray(value.pages) || value.pages.length === 0 ||
        !Array.isArray(value.navigation) || !Array.isArray(value.redirects)) return false;
    const paths = new Set();
    for (const page of value.pages) {
        if (!strings(page, ['path', 'pageKey', 'entryId']) || !page.path.startsWith('/') ||
            paths.has(page.path) || !isPresetPreviewPayload(page.content)) return false;
        paths.add(page.path);
    }
    return paths.has('/') && value.navigation.every((link) =>
        strings(link, ['label', 'path']) && paths.has(link.path)) &&
        value.redirects.every((redirect) => strings(redirect, ['from', 'to']));
}
