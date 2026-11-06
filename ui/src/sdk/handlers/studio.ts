import type { EditorSessionKey, StudioDraftOverlay } from '@bcms/selfhosted-backend/studio/draft-preview';
import type { ReleaseSnapshot } from '@bcms/selfhosted-backend/presets/releases';
import type { EntryCreateBody } from '@bcms/selfhosted-backend/entry/models/controller';
import type { Sdk } from '../main';
import type { StudioField, StudioValue } from '@bcms/selfhosted-backend/studio/business';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
import type { PageSectionOptions } from '@bcms/selfhosted-backend/presets/pages';
export interface NavigationNode { id: string; label: string; href?: string; children: NavigationNode[]; enabled: boolean }
export interface SiteOperations { seoTitle: string; seoDescription: string; socialImage?: { _id: string }; favicon?: { _id: string }; analyticsId?: string; contactFormEnabled: boolean }
export interface StudioEntry { id: string; updatedAt: number; fields: Record<string, unknown>; hasLanguage: boolean }
export interface StudioEditorField { key: string; label: string; control: string; required: boolean; array: boolean; description?: string; default?: unknown; options?: string[] }
export interface StudioModel { key: string; label: string; templateId: string; singleEntry: boolean; canCreate: boolean; canEdit: boolean; fields: StudioField[]; editorFields?: StudioEditorField[]; entries: StudioEntry[] }
export interface StudioState {
    status?: string;
    site: null | { id: string; name: string; updatedAt: number; language: string; presetId: string; presetVersion: string; publicTemplate: boolean; canManage: boolean;
        theme: { background: string; foreground: string; accent: string; muted: string; font: string }; pages: PageDraft[];
        editorContract?: import('@bcms/selfhosted-backend/template-contract/model').TemplateEditorContract | null;
        navigation?: NavigationNode[];
        operations: SiteOperations;
        contactDeliveryConfigured?: boolean;
        pageOptions: Record<string, PageSectionOptions | null>; blueprints: Array<{ key: string; title: string; modelKey: string }> };
    models: StudioModel[];
}
export class StudioHandler {
    constructor(private sdk: Sdk) {}
    preview(data: { sessionId: string; revision: number; language: string; overlay: StudioDraftOverlay }, signal?: AbortSignal) {
        return this.sdk.send<EditorSessionKey & { payload: ReleaseSnapshot & { kind: 'preset-site'; siteName: string } }>({ url: '/api/v4/studio/preview', method: 'POST', data, signal });
    }
    getSite() { return this.sdk.send<StudioState>({ url: '/api/v4/studio/site', method: 'GET' }); }
    saveEntry(modelKey: string, data: { entryId?: string; operationId: string; expectedUpdatedAt?: number; fields?: Record<string, StudioValue>; entry?: EntryCreateBody; language?: string; overlay?: StudioDraftOverlay }) {
        return this.sdk.send<{ id: string; updatedAt: number }>({ url: `/api/v4/studio/entries/${encodeURIComponent(modelKey)}`, method: 'POST', data });
    }
    createPage(data: { operationId: string; expectedUpdatedAt: number; title: string; path: string; blueprintKey: string; page?: Omit<import('@bcms/selfhosted-backend/presets/pages').PageDraftUpdate, 'title' | 'path' | 'entryId'>; fields?: Record<string, StudioValue>; entry?: import('@bcms/selfhosted-backend/entry/models/controller').EntryCreateBody }) {
        return this.sdk.send<import('@bcms/selfhosted-backend/studio/page-create').PageCreateReceipt>({ url: '/api/v4/studio/pages', method: 'POST', data });
    }
    savePage(pageKey: string, data: { expectedUpdatedAt: number; title: string; path: string; seoTitle: string; seoDescription: string; sections: string[]; sectionConfigs?: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }>; layoutDocument?: unknown; entryId: string; enabled: boolean; navigation: boolean; overlay?: StudioDraftOverlay }) {
        return this.sdk.send<PageDraft & { siteUpdatedAt: number }>({ url: `/api/v4/studio/pages/${encodeURIComponent(pageKey)}`, method: 'POST', data });
    }
    saveSettings(data: { expectedUpdatedAt: number; name: string; theme: { background: string; foreground: string; accent: string; muted: string }; navigation?: NavigationNode[]; operations?: SiteOperations }) {
        return this.sdk.send<{ updatedAt: number }>({ url: '/api/v4/studio/settings', method: 'POST', data });
    }
}
