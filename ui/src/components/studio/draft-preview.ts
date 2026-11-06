import type { EditorSessionKey, StudioDraftOverlay } from '@bcms/selfhosted-backend/studio/draft-preview';
export function acceptPreview(current: EditorSessionKey, incoming: EditorSessionKey): boolean {
    return current.sessionId === incoming.sessionId && current.revision === incoming.revision && current.workspaceId === incoming.workspaceId && current.siteId === incoming.siteId && current.language === incoming.language;
}
/** Request retirement is independent of transport cancellation: late responses always fail identity checks. */
export function createDraftPreview<T>(options: { key: () => EditorSessionKey; debounceMs?: number; request: (body: { sessionId: string; revision: number; language: string; overlay: StudioDraftOverlay }, signal: AbortSignal) => Promise<EditorSessionKey & { payload: T }>; accept: (payload: T) => void; fail: (error: unknown) => void }) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let generation = 0;
    let disposed = false;
    const cancel = () => { generation++; clearTimeout(timer); controller?.abort(); };
    return {
        update(overlay: StudioDraftOverlay, composing = false) {
            cancel();
            if (disposed || composing) return;
            const ownGeneration = generation;
            const key = { ...options.key() };
            const scheduledOverlay = JSON.parse(JSON.stringify(overlay)) as StudioDraftOverlay;
            timer = setTimeout(async () => {
                controller = new AbortController();
                try {
                    const result = await options.request({ sessionId: key.sessionId, revision: key.revision, language: key.language, overlay: scheduledOverlay }, controller.signal);
                    if (!disposed && generation === ownGeneration && acceptPreview(options.key(), result)) options.accept(result.payload);
                } catch (error) {
                    if (!disposed && generation === ownGeneration && acceptPreview(options.key(), key)) options.fail(error);
                }
            }, options.debounceMs ?? 300);
        },
        cancel,
        dispose() { disposed = true; cancel(); },
    };
}

/** Preserve the server's authorized location while letting the UI translate the reason. */
export function draftValidation(error: unknown) {
    const details = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; status?: number } : {};
    const location: { field?: string; entryId?: string; modelKey?: string; pageKey?: string; saveAllowed?: boolean; missingTranslations?: Array<{ code: string; entryId: string; modelKey: string; language: string; pageKey?: string }> } = {};
    if (typeof details.code === 'string' && details.code.startsWith('studio-validation:')) {
        try {
            const parsed = JSON.parse(details.code.slice('studio-validation:'.length));
            if (Array.isArray(parsed.missingTranslations) && parsed.missingTranslations.length && parsed.missingTranslations.every((issue: any) => issue?.code === 'missing-translation' && ['entryId','modelKey','language'].every(key => typeof issue[key] === 'string'))) {
                location.missingTranslations = parsed.missingTranslations;
                location.saveAllowed = parsed.saveAllowed === true;
            }
            for (const key of ['field', 'entryId', 'modelKey', 'pageKey'] as const) if (typeof parsed[key] === 'string') location[key] = parsed[key];
        } catch { /* An unrecognized location never authorizes navigation. */ }
    }
    const raw = typeof details.message === 'string' ? details.message : '';
    const match = raw.match(/^([a-zA-Z0-9_.-]+): (.+)$/s);
    if (match && (location.field === match[1] || /^(section\.|content$|body$)/.test(match[1]))) {
        location.field ||= match[1];
        return { ...location, cause: { ...details, message: match[2] } };
    }
    return { ...location, cause: error };
}
