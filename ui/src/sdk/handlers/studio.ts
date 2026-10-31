import type { Sdk } from '../main';
import type { StudioField, StudioValue } from '@bcms/selfhosted-backend/studio/business';
import type { PageDraft } from '@bcms/selfhosted-backend/presets/pages';
export interface NavigationNode { id: string; label: string; href?: string; children: NavigationNode[]; enabled: boolean }
export interface SiteOperations { seoTitle: string; seoDescription: string; socialImage?: { _id: string }; favicon?: { _id: string }; analyticsId?: string; contactFormEnabled: boolean }
export interface StudioEntry { id: string; updatedAt: number; fields: Record<string, unknown>; hasLanguage: boolean }
export interface StudioModel { key: string; label: string; templateId: string; singleEntry: boolean; canCreate: boolean; canEdit: boolean; fields: StudioField[]; entries: StudioEntry[] }
export interface StudioState {
    status?: string;
    site: null | { id: string; name: string; updatedAt: number; language: string; presetId: string; presetVersion: string; publicTemplate: boolean; canManage: boolean;
        theme: { background: string; foreground: string; accent: string; muted: string; font: string }; pages: PageDraft[];
        navigation?: NavigationNode[];
        operations: SiteOperations;
        pageOptions: Record<string, { allowed: string[]; required: string } | null>; blueprints: Array<{ key: string; title: string; modelKey: string }> };
    models: StudioModel[];
}
export class StudioHandler {
    constructor(private sdk: Sdk) {}
    getSite() { return this.sdk.send<StudioState>({ url: '/api/v4/studio/site', method: 'GET' }); }
    saveEntry(modelKey: string, data: { entryId?: string; operationId: string; expectedUpdatedAt?: number; fields: Record<string, StudioValue> }) {
        return this.sdk.send<{ id: string; updatedAt: number }>({ url: `/api/v4/studio/entries/${encodeURIComponent(modelKey)}`, method: 'POST', data });
    }
    createPage(data: { operationId: string; expectedUpdatedAt: number; title: string; path: string; blueprintKey: string; fields: Record<string, StudioValue> }) {
        return this.sdk.send<PageDraft>({ url: '/api/v4/studio/pages', method: 'POST', data });
    }
    savePage(pageKey: string, data: { expectedUpdatedAt: number; title: string; path: string; seoTitle: string; seoDescription: string; sections: string[]; sectionConfigs?: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }>; entryId: string; enabled: boolean; navigation: boolean }) {
        return this.sdk.send<PageDraft>({ url: `/api/v4/studio/pages/${encodeURIComponent(pageKey)}`, method: 'POST', data });
    }
    saveSettings(data: { expectedUpdatedAt: number; name: string; theme: { background: string; foreground: string; accent: string; muted: string }; navigation?: NavigationNode[]; operations?: SiteOperations }) {
        return this.sdk.send<{ updatedAt: number }>({ url: '/api/v4/studio/settings', method: 'POST', data });
    }
}
