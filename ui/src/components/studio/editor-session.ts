import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
import type { EditorTarget } from './editor-target';
import type { SavePart } from './save-session';
export interface EditorDraft { entry?: Entry; page?: PageDraft; settings: any }
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
export function createEditorSession(target: EditorTarget, draft: EditorDraft, sessionId = crypto.randomUUID()) {
    return { target: { ...target }, sessionId, revision: 0, operationId: crypto.randomUUID(), draft: clone(draft),
        baseline: { content: JSON.stringify(draft.entry), page: JSON.stringify(draft.page), settings: JSON.stringify(draft.settings) }, created: target.intent !== 'create' };
}
export type EditorSession = ReturnType<typeof createEditorSession>;
export function sessionDirty(session: EditorSession) {
    return { content: Boolean(session.draft.entry) && (!session.created || JSON.stringify(session.draft.entry) !== session.baseline.content),
        page: Boolean(session.draft.page) && JSON.stringify(session.draft.page) !== session.baseline.page,
        settings: JSON.stringify(session.draft.settings) !== session.baseline.settings };
}
export function acknowledgeSession(session: EditorSession, parts: SavePart['key'][]) {
    for (const key of parts) session.baseline[key] = JSON.stringify(key === 'content' ? session.draft.entry : session.draft[key]);
    if (parts.includes('content')) session.created = true;
}
