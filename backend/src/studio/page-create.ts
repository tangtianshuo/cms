import type { Entry } from '../entry/models/main';
import type { SiteInstallation } from '../presets/site-model';
import { createPageDraft, pageDraft, type PageDraft } from '../presets/pages';
import { pageOperationIds } from './business';
export interface PageCreateSource {
    findEntry(id: string): Promise<Entry | null>;
    addEntry(entry: Entry): Promise<Entry>;
    saveSite(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
    findSite(): Promise<SiteInstallation | null>;
}
export async function createStudioPage(site: SiteInstallation, operationId: string, entry: Entry,
    input: { title: string; path: string; blueprintKey: string }, source: PageCreateSource): Promise<PageDraft> {
    const ids = pageOperationIds(site._id, operationId);
    if (entry._id !== ids.entryId) throw new Error('Invalid page operation identity');
    const oldPage = pageDraft(site, ids.pageKey);
    if (oldPage) {
        if (oldPage.entryId !== ids.entryId || oldPage.blueprintKey !== input.blueprintKey || oldPage.path !== input.path || oldPage.title !== input.title) throw Object.assign(new Error('Operation already used; start a new page'), { status: 409 });
        const existing = await source.findEntry(ids.entryId);
        if (!existing || existing.templateId !== entry.templateId || JSON.stringify(existing.meta) !== JSON.stringify(entry.meta)) throw Object.assign(new Error('Operation Entry changed; start a new page'), { status: 409 });
        return oldPage;
    }
    const blueprint = site.pages.find(page => page.key === input.blueprintKey && !page.blueprintKey);
    if (!blueprint || blueprint.layout !== 'content-page') throw new Error('Only installed content page blueprints support Studio creation');
    const options = pageDraft(site, blueprint.key)!;
    // Validate route conflicts before writing any Entry.
    const updated = createPageDraft(site, ids.pageKey, { ...options, ...input, entryId: entry._id, seoTitle: input.title,
        seoDescription: '', enabled: true, navigation: true }, entry);
    let existing = await source.findEntry(ids.entryId);
    if (!existing) {
        try { existing = await source.addEntry(entry); }
        catch (cause) { existing = await source.findEntry(ids.entryId); if (!existing) throw cause; }
    }
    if (existing.templateId !== entry.templateId || JSON.stringify(existing.meta) !== JSON.stringify(entry.meta)) throw Object.assign(new Error('Operation Entry changed; use its advanced editor or start a new page'), { status: 409 });
    if (!await source.saveSite(updated, site.updatedAt)) {
        const latest = await source.findSite();
        const winner = latest && pageDraft(latest, ids.pageKey);
        if (winner && winner.entryId === ids.entryId && winner.path === input.path && winner.title === input.title) return winner;
        throw Object.assign(new Error(`Page content saved as Entry ${ids.entryId}, but routes changed. Refresh and retry the same operation to bind it.`), { status: 409 });
    }
    return pageDraft(updated, ids.pageKey)!;
}
