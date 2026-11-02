function validatePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path) || /^\/(?:%2f|%5c)/i.test(path)) {
        throw new Error('Invalid published path');
    }
}

function runtimeMetadata(release, path) {
    const snapshot = release?.snapshot;
    return {
        origin: snapshot?.origin || '',
        primaryHostname: snapshot?.primaryHostname || '',
        bindingRevision: Number.isInteger(snapshot?.bindingRevision) ? snapshot.bindingRevision : 0,
        releaseId: release.releaseId,
        language: snapshot?.language || '',
        path,
        navigation: Array.isArray(snapshot?.navigation) ? snapshot.navigation : [],
    };
}

export function resolveRuntimePublishedPage(release, path) {
    validatePath(path);
    const snapshot = release?.snapshot;
    if (!release || !snapshot || typeof release.releaseId !== 'string') return null;
    const metadata = runtimeMetadata(release, path);
    const redirect = Array.isArray(snapshot.redirects)
        ? snapshot.redirects.find((item) => item?.from === path && typeof item.to === 'string')
        : undefined;
    if (redirect) return { ...metadata, redirect: redirect.to };
    const page = Array.isArray(snapshot.pages)
        ? snapshot.pages.find((item) => item?.path === path)
        : undefined;
    if (!page) return null;
    return { ...metadata, content: page.content };
}

export function runtimeSitemap(release) {
    const snapshot = release?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.paths)) return [];
    return snapshot.paths.filter((path) => {
        try {
            validatePath(path);
            return true;
        } catch {
            return false;
        }
    });
}
