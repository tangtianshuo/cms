import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { RP } from '../security/route-protection/main';
import { Repo } from '../repo';
import { canReadContent, canWriteContent, workspaceContext } from '../workspaces/context';
import { resolveInstalledPreset } from '../presets/installed';
import { pageDraft, pageSectionOptions, updatePageDraft } from '../presets/pages';
import type { SiteInstallation } from '../presets/site-model';
import { assertStudioWrite, entryValues, fieldDescriptors, pageOperationIds, patchEntry, type StudioValue } from './business';
import { createStudioPage } from './page-create';

const studioValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.object({ _id: z.string().min(1), alt_text: z.string().optional(), caption: z.string().optional() }).strict()), z.array(z.object({ tid: z.string().min(1), eid: z.string().min(1) }).strict())]);
const entryBody = z.object({ entryId: z.string().min(1).optional(), operationId: z.string().uuid(), expectedUpdatedAt: z.number().int().nonnegative().optional(), fields: z.record(studioValueSchema) }).strict();
const pageBody = z.object({ expectedUpdatedAt: z.number().int().nonnegative(), title: z.string().trim().min(1).max(120), path: z.string().min(1).max(160), seoTitle: z.string().max(120), seoDescription: z.string().max(320), sections: z.array(z.string()).min(1), entryId: z.string(), enabled: z.boolean(), navigation: z.boolean() }).strict();
async function selectedSite() {
    const site = await Repo.siteInstallation.methods.findSelected();
    if (!site || site.status !== 'ready') throw Object.assign(new Error('Select a site with an installed, ready template'), { status: 404 });
    resolveInstalledPreset(site);
    return site;
}
async function installedModel(site: SiteInstallation, key: string) {
    const mapping = site.models.find(item => item.key === key);
    const template = mapping && await Repo.template.findById(mapping.templateId);
    if (!mapping || !template || !canReadContent('Template', template)) throw Object.assign(new Error('Installed model not found or not permitted'), { status: 403 });
    return template;
}
async function validateSelectedMedia(site: SiteInstallation, modelKey: string, fields: Record<string, StudioValue>) {
    const template = await installedModel(site, modelKey);
    for (const field of fieldDescriptors(site, template, modelKey).filter(item => item.type === 'MEDIA')) {
        const values = fields[field.key];
        if (!Array.isArray(values)) continue;
        for (const value of values) if ('_id' in value) {
            const media = await Repo.media.findById(value._id);
            if (!media || !['IMG', 'SVG', 'GIF'].includes(media.type)) throw new Error(`${field.label}: select an accessible image`);
        }
    }
}
function conflict() { return Object.assign(new Error('Site changed; refresh before saving'), { status: 409 }); }
export const StudioController = createController({ name: 'Studio', path: '/api/v4/studio', methods() {
    return {
        site: createControllerMethod({ path: '/site', type: 'get', preRequestHandler: RP.createJwtCheck(['USER']), async handler({ errorHandler }) {
            const site = await Repo.siteInstallation.methods.findSelected();
            if (!site || site.status !== 'ready') return { site: null, status: site?.status || 'empty', models: [] };
            const preset = resolveInstalledPreset(site);
            const models = [];
            for (const mapping of site.models) {
                if (!canReadContent('Template', { _id: mapping.templateId })) continue;
                const template = await Repo.template.findById(mapping.templateId);
                if (!template) continue;
                const entries = (await Repo.entry.methods.findAllByTemplateId(template._id)).filter(entry => !entry.siteId || entry.siteId === site._id);
                models.push({ key: mapping.key, label: template.label, templateId: template._id, singleEntry: template.singleEntry,
                    canCreate: canWriteContent('Entry', { templateId: template._id }, 'post'), canEdit: canWriteContent('Entry', { templateId: template._id }, 'put'),
                    fields: fieldDescriptors(site, template, mapping.key), entries: entries.map(entry => ({ id: entry._id, updatedAt: entry.updatedAt, fields: entryValues(site, mapping.key, entry),
                        hasLanguage: entry.meta.some(meta => meta.lng === (site.language || 'en')) })) });
            }
            if (!workspaceContext()) throw errorHandler(HttpStatus.Forbidden, 'Workspace context required');
            return { site: { id: site._id, name: site.name, updatedAt: site.updatedAt, language: site.language || 'en', presetId: site.presetId, presetVersion: site.presetVersion,
                publicTemplate: Boolean(site.publishedTemplateRecord), theme: site.theme, pages: site.pages.map(page => pageDraft(site, page.key)),
                pageOptions: Object.fromEntries(site.pages.map(page => [page.key, pageSectionOptions(page.layout)])),
                blueprints: preset.pages.filter(page => page.layout === 'content-page'), canManage: Boolean(workspaceContext()?.admin) }, models };
        } }),
        entry: createControllerMethod({ path: '/entries/:modelKey', type: 'post', preRequestHandler: RP.createJwtCheck(['USER']), async handler({ request, errorHandler }) {
            const parsed = entryBody.safeParse(request.body);
            if (!parsed.success || (parsed.data.entryId && parsed.data.expectedUpdatedAt === undefined)) throw errorHandler(HttpStatus.BadRequest, 'Invalid Studio content request');
            try {
                const site = await selectedSite();
                const key = (request.params as { modelKey: string }).modelKey;
                const template = await installedModel(site, key);
                assertStudioWrite(template._id, parsed.data.entryId ? 'put' : 'post');
                const previous = parsed.data.entryId ? await Repo.entry.findById(parsed.data.entryId) : null;
                if (parsed.data.entryId && !previous) throw new Error('Entry not found');
                if (previous && previous.updatedAt !== parsed.data.expectedUpdatedAt) throw conflict();
                await validateSelectedMedia(site, key, parsed.data.fields);
                const id = createHash('sha256').update(`${site._id}:studio:${key}:${template.singleEntry ? 'single' : parsed.data.operationId}`).digest('hex').slice(0, 24);
                if (!previous && template.singleEntry) {
                    const all = await Repo.entry.methods.findAllByTemplateId(template._id);
                    if (all.some(entry => entry._id !== id)) throw new Error('This model already has content; refresh and edit it');
                }
                const updated = patchEntry(site, template, key, previous, parsed.data.fields, workspaceContext()!.actorId, id);
                let saved;
                if (previous) saved = await Repo.entry.update(updated, false, parsed.data.expectedUpdatedAt);
                else {
                    const existing = await Repo.entry.findById(id);
                    if (existing) {
                        if (JSON.stringify(existing.meta) !== JSON.stringify(updated.meta)) throw conflict();
                        saved = existing;
                    } else {
                        try { saved = await Repo.entry.add(updated); }
                        catch (cause) {
                            const retry = await Repo.entry.findById(id);
                            if (!retry || JSON.stringify(retry.meta) !== JSON.stringify(updated.meta)) throw cause;
                            saved = retry;
                        }
                    }
                }
                return { id: saved._id, updatedAt: saved.updatedAt };
            } catch (cause) { throw errorHandler((cause as { status?: number }).status || HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Save failed'); }
        } }),
        addPage: createControllerMethod({ path: '/pages', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler({ request, errorHandler }) {
            const parsed = z.object({ operationId: z.string().uuid(), expectedUpdatedAt: z.number().int().nonnegative(), title: z.string().trim().min(1).max(120), path: z.string().max(160), blueprintKey: z.string(), fields: z.record(studioValueSchema) }).strict().safeParse(request.body);
            if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid new page');
            try {
                const site = await selectedSite();
                const blueprint = site.pages.find(page => page.key === parsed.data.blueprintKey && !page.blueprintKey && page.layout === 'content-page');
                if (!blueprint) throw new Error('Content page blueprint is unavailable');
                const template = await installedModel(site, blueprint.modelKey);
                assertStudioWrite(template._id, 'post');
                const ids = pageOperationIds(site._id, parsed.data.operationId);
                if (site.updatedAt !== parsed.data.expectedUpdatedAt && !pageDraft(site, ids.pageKey)) {
                    // Retry after an interrupted binding is safe; new stale requests cannot write.
                    if (!await Repo.entry.findById(ids.entryId)) throw conflict();
                }
                await validateSelectedMedia(site, blueprint.modelKey, parsed.data.fields);
                const entry = patchEntry(site, template, blueprint.modelKey, null, parsed.data.fields, workspaceContext()!.actorId, ids.entryId);
                return await createStudioPage(site, parsed.data.operationId, entry, parsed.data, {
                    findEntry: id => Repo.entry.findById(id), addEntry: createdEntry => Repo.entry.add(createdEntry),
                    saveSite: (updated, expected) => Repo.siteInstallation.methods.saveDraft(updated, expected), findSite: () => Repo.siteInstallation.methods.findSelected(),
                });
            } catch (cause) { throw errorHandler((cause as { status?: number }).status || HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Page creation failed'); }
        } }),
        page: createControllerMethod({ path: '/pages/:pageKey', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler({ request, errorHandler }) {
            const parsed = pageBody.safeParse(request.body);
            if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid page draft');
            try {
                const site = await selectedSite();
                if (site.updatedAt !== parsed.data.expectedUpdatedAt) throw conflict();
                const key = (request.params as { pageKey: string }).pageKey;
                const bound = parsed.data.entryId ? await Repo.entry.findById(parsed.data.entryId) : null;
                const updated = updatePageDraft(site, key, parsed.data, bound);
                if (!await Repo.siteInstallation.methods.saveDraft(updated, site.updatedAt)) throw conflict();
                return pageDraft(updated, key);
            } catch (cause) { throw errorHandler((cause as { status?: number }).status || HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Page save failed'); }
        } }),
        settings: createControllerMethod({ path: '/settings', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(), async handler({ request, errorHandler }) {
            const parsed = z.object({ expectedUpdatedAt: z.number().int().nonnegative(), name: z.string().trim().min(1).max(80), theme: z.object({ background: z.string().regex(/^#[a-f0-9]{6}$/i), foreground: z.string().regex(/^#[a-f0-9]{6}$/i), accent: z.string().regex(/^#[a-f0-9]{6}$/i), muted: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict() }).strict().safeParse(request.body);
            if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Name and four six-digit theme colors are required');
            const site = await selectedSite();
            if (site.updatedAt !== parsed.data.expectedUpdatedAt) throw errorHandler(HttpStatus.Conflict, 'Site changed; refresh before saving');
            const updated = { ...site, name: parsed.data.name, theme: { ...site.theme, ...parsed.data.theme } };
            if (!await Repo.siteInstallation.methods.saveDraft(updated, site.updatedAt)) throw errorHandler(HttpStatus.Conflict, 'Site changed; refresh before saving');
            return { updatedAt: updated.updatedAt };
        } }),
    };
} });
