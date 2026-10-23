import type { Entry } from '@bcms/selfhosted-backend/entry/models/main';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';

export interface PreviewSiteContext {
    status: SiteInstallation['status'];
    models: Array<Pick<SiteInstallation['models'][number], 'key' | 'templateId'>>;
    pages: Array<Pick<SiteInstallation['pages'][number], 'key' | 'title' | 'modelKey'>>;
}

export function availablePreviewPages(site: PreviewSiteContext | null, templateId: string) {
    if (!site || site.status !== 'ready') return [];
    const model = site.models.find((item) => item.templateId === templateId);
    if (!model) return [];
    return model.key === 'site-settings'
        ? site.pages
        : site.pages.filter((page) => page.modelKey === model.key);
}

export function buildPagePreviewRequest(
    site: PreviewSiteContext, entry: Entry, pageKey: string, language: string,
) {
    if (!availablePreviewPages(site, entry.templateId).some((page) => page.key === pageKey)) {
        throw new Error('Entry cannot preview the selected page');
    }
    return { entry, pageKey, language };
}
