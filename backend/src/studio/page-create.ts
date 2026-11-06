import type { Entry } from '../entry/models/main';
import type { SiteInstallation } from '../presets/site-model';
import { createPageDraft, pageDraft, type PageDraft, type PageDraftUpdate } from '../presets/pages';
import { pageOperationIds } from './business';
export interface PageCreateSource {
    findEntry(id: string): Promise<Entry | null>;
    addEntry(entry: Entry): Promise<Entry>;
    saveSite(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
    findSite(): Promise<SiteInstallation | null>;
}
export type PageCreateInput = { title: string; path: string; blueprintKey: string; page?: Omit<PageDraftUpdate, 'title' | 'path' | 'entryId'> };
export type PageCreateReceipt = PageDraft & { siteUpdatedAt: number; entryUpdatedAt: number };
function canonical(value: unknown): string {
    const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
    return JSON.stringify(sort(value));
}
function pageSemantics(page: PageDraft) {
    const { title, path, blueprintKey, seoTitle, seoDescription, sections, sectionConfigs, layoutDocument, entryId, enabled, navigation } = page;
    return canonical({ title, path, blueprintKey, seoTitle, seoDescription, sections, sectionConfigs, layoutDocument, entryId, enabled: enabled !== false, navigation: navigation !== false });
}
function sameContent(a: Entry, b: Entry) {
    return a.templateId === b.templateId && a.siteId === b.siteId && a.groupId === b.groupId && JSON.stringify(a.meta) === JSON.stringify(b.meta) && JSON.stringify(a.content) === JSON.stringify(b.content) && JSON.stringify(a.statuses) === JSON.stringify(b.statuses);
}
export async function createStudioPage(site: SiteInstallation, operationId: string, entry: Entry,
    input: PageCreateInput, source: PageCreateSource, expectedUpdatedAt = site.updatedAt): Promise<PageCreateReceipt> {
    const ids = pageOperationIds(site._id, operationId);
    if (entry._id !== ids.entryId) throw new Error('Invalid page operation identity');
    const oldPage = pageDraft(site, ids.pageKey);
    const blueprint = site.pages.find(page => page.key === input.blueprintKey && !page.blueprintKey);
    if (!blueprint || blueprint.layout !== 'content-page') throw new Error('Only installed content page blueprints support Studio creation');
    const options = pageDraft(site, blueprint.key)!;
    // Reconstruct identity and normalize complete writable semantics before any Entry write, including replay.
    const updated = createPageDraft({ ...site, pages: site.pages.filter(page => page.key !== ids.pageKey) }, ids.pageKey, {
        ...options, seoTitle: input.title, seoDescription: '', enabled: true, navigation: true, ...input.page,
        title: input.title, path: input.path, blueprintKey: input.blueprintKey, entryId: entry._id,
    }, entry);
    if (oldPage) {
        if (pageSemantics(oldPage) !== pageSemantics(pageDraft(updated, ids.pageKey)!)) throw Object.assign(new Error('Operation page changed; start a new page'), { status: 409 });
        const existing = await source.findEntry(ids.entryId);
        if (!existing || !sameContent(existing, entry)) throw Object.assign(new Error('Operation Entry changed; start a new page'), { status: 409 });
        const receipt = site.pages.find(page => page.key === ids.pageKey)?.creationReceipt;
        if (!receipt || receipt.expectedUpdatedAt !== expectedUpdatedAt || receipt.siteUpdatedAt !== site.updatedAt || receipt.entryUpdatedAt === undefined || receipt.entryUpdatedAt !== existing.updatedAt) throw Object.assign(new Error('Site or Entry changed after page creation; review the saved page before continuing'), { status: 409 });
        return { ...oldPage, siteUpdatedAt: receipt.siteUpdatedAt, entryUpdatedAt: receipt.entryUpdatedAt };
    }
    if (site.updatedAt !== expectedUpdatedAt) throw Object.assign(new Error('Site changed before page creation; check the server version'), { status: 409 });
    let existing = await source.findEntry(ids.entryId);
    if (!existing) {
        try { existing = await source.addEntry(entry); }
        catch (cause) { existing = await source.findEntry(ids.entryId); if (!existing) throw cause; }
    }
    if (!sameContent(existing, entry)) throw Object.assign(new Error('Operation Entry changed; use its advanced editor or start a new page'), { status: 409 });
    // A fresh insertion owns its write receipt. Orphan recovery confirms only this
    // exact matching observed version; later Entry edits must still pass content CAS.
    const entryUpdatedAt = existing.updatedAt;
    updated.pages.find(page => page.key === ids.pageKey)!.creationReceipt = { expectedUpdatedAt, siteUpdatedAt: 0, entryUpdatedAt };
    if (!await source.saveSite(updated, site.updatedAt)) {
        throw Object.assign(new Error(`Page content saved as Entry ${ids.entryId}, but routes changed. Refresh and retry the same operation to bind it.`), { status: 409 });
    }
    return { ...pageDraft(updated, ids.pageKey)!, siteUpdatedAt: updated.updatedAt, entryUpdatedAt };
}
