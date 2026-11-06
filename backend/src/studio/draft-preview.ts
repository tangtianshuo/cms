import { createHash } from 'node:crypto';
import type { Entry } from '../entry/models/main';
import type { EntryCreateBody } from '../entry/models/controller';
import type { NavigationNode } from '../presets/navigation';
import { normalizeNavigation } from '../presets/navigation';
import type { SiteOperations } from '../presets/operations';
import { createPageDraft, pageDraft, updatePageDraft, type PageDraft } from '../presets/pages';
import { buildRelease, validateReleaseDraft, type ReleaseInput, type ReleaseSnapshot } from '../presets/releases';
import { ownerWorkspace } from '../workspaces/context';
import { pageOperationIds, patchEntry, type StudioValue } from './business';
export interface EditorSessionKey { sessionId: string; revision: number; workspaceId: string; siteId: string; language: string }
export interface StudioSettingsDraft { expectedUpdatedAt: number; name: string; theme: { background: string; foreground: string; accent: string; muted: string }; navigation?: NavigationNode[]; operations?: SiteOperations }
export interface StudioDraftOverlay { entry?: { modelKey: string; entryId?: string; operationId: string; fields?: Record<string, StudioValue>; entry?: EntryCreateBody }; page?: PageDraft; settings?: StudioSettingsDraft }
export function studioEntryId(siteId: string, modelKey: string, operationId: string, singleEntry = false) {
    return createHash('sha256').update(`${siteId}:studio:${modelKey}:${singleEntry ? 'single' : operationId}`).digest('hex').slice(0, 24);
}
/** Full content updates merge only the selected language; identity and other languages remain server-owned. */
export function mergeStudioEntry(previous: Entry, body: EntryCreateBody, language: string): Entry {
    const result = structuredClone(previous);
    for (const key of ['meta', 'content', 'statuses'] as const) {
        const selected = body[key].filter(item => item.lng === language);
        if (key !== 'statuses' && selected.length !== 1) throw new Error(`Missing ${language} ${key}`);
        (result[key] as Array<{ lng: string }>) = [...result[key].filter(item => item.lng !== language), ...structuredClone(selected)];
    }
    if (body.groupId !== undefined) result.groupId = body.groupId;
    return result;
}
/** In-memory projection only. The caller authorizes resources and validates the body before invoking this function. */
export function buildStudioDraftPreview(input: ReleaseInput, overlay: StudioDraftOverlay): ReleaseSnapshot {
    return buildRelease(studioDraftInput(input, overlay), { preserveMediaCapabilities: true });
}
export function validateStudioDraft(input: ReleaseInput, overlay: StudioDraftOverlay) {
    return validateReleaseDraft(studioDraftInput(input, overlay));
}
function studioDraftInput(input: ReleaseInput, overlay: StudioDraftOverlay): ReleaseInput {
    const draft = structuredClone(input);
    let changedEntry: Entry | undefined;
    if (overlay.entry) {
        const value = overlay.entry;
        if ((value.fields === undefined) === (value.entry === undefined)) throw new Error('Choose fields or full Entry content');
        const mapping = draft.site.models.find(model => model.key === value.modelKey);
        const template = draft.templates.find(item => item._id === mapping?.templateId);
        if (!mapping || !template) throw new Error('Installed model not found');
        const previous = value.entryId ? draft.entries.find(item => item._id === value.entryId) : undefined;
        if (value.entryId && (!previous || previous.templateId !== template._id || ownerWorkspace(previous) !== ownerWorkspace(draft.site) || previous.siteId && previous.siteId !== draft.site._id)) throw new Error('Entry not found in selected site');
        const id = value.entryId || (overlay.page?.blueprintKey && !draft.site.pages.some(page => page.key === overlay.page?.key) ? pageOperationIds(draft.site._id, value.operationId).entryId : studioEntryId(draft.site._id, value.modelKey, value.operationId, template.singleEntry));
        if (value.entry) {
            changedEntry = previous ? mergeStudioEntry(previous, value.entry, draft.language) : { _id: id, workspaceId: ownerWorkspace(draft.site), siteId: draft.site._id, templateId: template._id, userId: '', createdAt: 0, updatedAt: 0, groupId: value.entry.groupId || draft.site.contentGroupId || draft.site._id, ...structuredClone(value.entry) };
        } else changedEntry = patchEntry({ ...draft.site, language: draft.language }, template, value.modelKey, previous || null, value.fields!, '', id);
        draft.entries = [...draft.entries.filter(item => item._id !== id), changedEntry];
    }
    if (overlay.page) {
        const value = overlay.page;
        const bound = draft.entries.find(item => item._id === value.entryId) || changedEntry;
        if (pageDraft(draft.site, value.key)) draft.site = updatePageDraft(draft.site, value.key, value, bound);
        else {
            if (!value.blueprintKey || !overlay.entry) throw new Error('Page not found');
            const blueprint = draft.site.pages.find(page => page.key === value.blueprintKey && !page.blueprintKey && page.layout === 'content-page');
            if (!blueprint || blueprint.modelKey !== overlay.entry.modelKey || !changedEntry) throw new Error('Page blueprint not found');
            const ids = pageOperationIds(draft.site._id, overlay.entry.operationId);
            draft.site = createPageDraft(draft.site, ids.pageKey, { ...value, blueprintKey: blueprint.key, entryId: ids.entryId }, changedEntry);
        }
    }
    if (overlay.settings) {
        const { name, theme, navigation, operations } = structuredClone(overlay.settings);
        draft.site = { ...draft.site, name, theme: { ...draft.site.theme, ...theme }, ...(navigation ? { navigation: normalizeNavigation(navigation) } : {}), ...(operations ? { operations } : {}) };
    }
    return draft;
}
