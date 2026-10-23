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
