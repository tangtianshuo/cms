// Fixed-schema diagnostics, never a native replay trace. Do not add arbitrary text.
const steps = new Set([
    'editor-open',
    'draft-input',
    'canvas-ready',
    'page-switch',
    'media-select',
    'rich-input',
    'save',
    'public-compare',
    'controlled-failure',
]);
const methods = new Set([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
]);
function routeClass(request) {
    try {
        const path = new URL(request.url()).pathname;
        if (path === '/api/v4/studio/preview') return 'preview';
        if (path === '/api/v4/storefront/preview-runtime') return 'resolver';
        if (path.startsWith('/api/v4/studio/')) return 'studio';
        if (path.startsWith('/api/v4/media/')) return 'media';
        if (path.startsWith('/preview/')) return 'renderer';
    } catch {
        /* unknown */
    }
    return 'other';
}
export function interactionTrace(page) {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const events = [];
    const add = (event) => {
        if (events.length < 1000)
            events.push({
                elapsedMs: Math.round((performance.now() - start) * 100) / 100,
                ...event,
            });
    };
    const requestFields = (request) => ({
        method: methods.has(request.method()) ? request.method() : 'OTHER',
        route: routeClass(request),
    });
    const listeners = {
        request: (request) =>
            add({ kind: 'request', ...requestFields(request) }),
        response: (response) => {
            const status = response.status();
            add({
                kind: 'response',
                ...requestFields(response.request()),
                status:
                    Number.isInteger(status) && status >= 100 && status <= 599
                        ? status
                        : 0,
            });
        },
        console: (message) =>
            add({
                kind: 'console',
                level: ['error', 'warning', 'info', 'log', 'debug'].includes(
                    message.type(),
                )
                    ? message.type()
                    : 'other',
            }),
        pageerror: () => add({ kind: 'pageerror' }),
        framenavigated: () => add({ kind: 'navigation' }),
        requestfailed: (request) =>
            add({ kind: 'requestfailed', ...requestFields(request) }),
    };
    for (const [event, listener] of Object.entries(listeners))
        page.on(event, listener);
    return {
        step(id) {
            if (!steps.has(id)) throw new Error('Unknown trace step');
            add({ kind: 'step', id });
        },
        finish() {
            for (const [event, listener] of Object.entries(listeners))
                page.off(event, listener);
            return {
                schemaVersion: 1,
                traceType: 'credential-safe-interaction-timeline',
                startedAt,
                durationMs: Math.round((performance.now() - start) * 100) / 100,
                events,
            };
        },
    };
}
