import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { workspaceContext, workspaceId } from '../workspaces/context';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import { buildChecklist } from './checklist';
import { getPreset, listPresets } from './catalog';
import { importPreset, planImport, type ImportSource } from './import';
import { createPageDraft, pageDraft, pageSectionOptions, updatePageDraft } from './pages';

const importBody = z.object({
    presetId: z.string().min(1),
    siteName: z.string().trim().min(1).max(80),
    includeDemo: z.boolean(),
}).strict();

const pageBody = z.object({
    title: z.string().min(1).max(120),
    path: z.string().min(1).max(160),
    seoTitle: z.string().max(120),
    seoDescription: z.string().max(320),
    sections: z.array(z.string()).min(1),
    entryId: z.string(),
    enabled: z.boolean().optional(),
    navigation: z.boolean().optional(),
}).strict();

export function importSource(): ImportSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findSelected(),
        claimSite: (site, expected) => Repo.siteInstallation.methods.saveDraft(site, expected),
        addSite: (site) => Repo.siteInstallation.add(site),
        updateSite: (site) => Repo.siteInstallation.methods.updateImport(site),
        findTemplate: (name) => Repo.template.methods.findByName(name),
        addTemplate: (template) => Repo.template.add(template),
        updateTemplate: (template) => Repo.template.update(template),
        findEntry: (id) => Repo.entry.findById(id),
        addEntry: (entry) => Repo.entry.add(entry),
        language: async () => (await Repo.language.findAll())[0]?.code || 'en',
    };
}

async function siteView() {
    const site = await Repo.siteInstallation.methods.findSelected();
    if (!site) return { site: null, checklist: [], pageOptions: {} };
    const templates: Parameters<typeof buildChecklist>[1] = {};
    const entries: Parameters<typeof buildChecklist>[2] = {};
    for (const model of site.models) {
        templates[model.key] = (await Repo.template.findById(model.templateId)) || undefined;
        entries[model.key] = await Repo.entry.methods.findAllByTemplateId(model.templateId);
    }
    return {
        site: { ...site, pages: site.pages.map((page) => pageDraft(site, page.key)) },
        checklist: buildChecklist(site, templates, entries),
        pageOptions: Object.fromEntries(site.pages.map((page) => [page.key, pageSectionOptions(page.layout)])),
    };
}

export const PresetController = createController({
    name: 'Presets',
    path: '/api/v4/presets',
    methods() {
        return {
            catalog: createControllerMethod({
                path: '/catalog', type: 'get',
                async handler() { return { items: listPresets() }; },
            }),
            manifest: createControllerMethod({
                path: '/catalog/:presetId', type: 'get',
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const preset = getPreset(presetId);
                    if (!preset) throw errorHandler(HttpStatus.NotFound, 'Preset not found');
                    return preset;
                },
            }),
            plan: createControllerMethod({
                path: '/plan/:presetId', type: 'get',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const preset = getPreset(presetId);
                    if (!preset) throw errorHandler(HttpStatus.NotFound, 'Preset not found');
                    return {
                        plan: await planImport(preset, importSource()),
                        installedSite: await Repo.siteInstallation.methods.findSelected(),
                    };
                },
            }),
            site: createControllerMethod({
                path: '/site', type: 'get',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler() { return siteView(); },
            }),
            previewContext: createControllerMethod({
                path: '/preview-context/:templateId', type: 'get',
                preRequestHandler: RP.createJwtCheck(['USER']),
                async handler({ request, errorHandler, token }) {
                    const { templateId } = request.params as { templateId: string };
                    const elevated = !!workspaceContext()?.admin;
                    const canRead = elevated || Boolean(token.payload.props?.policy?.templates
                        .find((item) => item._id === templateId)?.get);
                    if (!canRead) throw errorHandler(HttpStatus.Forbidden, 'Template access denied');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!site || site.status !== 'ready') return { site: null };
                    const model = site.models.find((item) => item.templateId === templateId);
                    if (!model) return { site: null };
                    const pages = model.key === 'site-settings' ? site.pages :
                        site.pages.filter((page) => page.modelKey === model.key);
                    return {
                        site: {
                            status: site.status,
                            models: [{ key: model.key, templateId: model.templateId }],
                            pages: pages.map((page) => ({ key: page.key, title: page.title,
                                modelKey: page.modelKey })),
                        },
                    };
                },
            }),
            pages: createControllerMethod({
                path: '/pages/:pageKey', type: 'post',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const { pageKey } = request.params as { pageKey: string };
                    const parsed = pageBody.safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid page draft');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!site || site.status !== 'ready' || !pageDraft(site, pageKey)) {
                        throw errorHandler(HttpStatus.NotFound, 'Page draft not found');
                    }
                    const boundEntry = parsed.data.entryId
                        ? await Repo.entry.findById(parsed.data.entryId) : null;
                    try {
                        const updated = updatePageDraft(site, pageKey, parsed.data, boundEntry);
                        if (!await Repo.siteInstallation.methods.saveDraft(updated, site.updatedAt)) {
                            throw new Error('Site changed; refresh before saving');
                        }
                        return pageDraft(updated, pageKey);
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest,
                            cause instanceof Error ? cause.message : 'Invalid page draft');
                    }
                },
            }),
            addPage: createControllerMethod({
                path: '/pages', type: 'post',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const parsed = pageBody.extend({ blueprintKey: z.string().min(1) }).safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid new page');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!site || site.status !== 'ready') throw errorHandler(HttpStatus.NotFound, 'Site not found');
                    try {
                        const key = randomUUID();
                        const bound = await Repo.entry.findById(parsed.data.entryId);
                        const updated = createPageDraft(site, key, parsed.data, bound);
                        if (!await Repo.siteInstallation.methods.saveDraft(updated, site.updatedAt)) {
                            throw new Error('Site changed; refresh before saving');
                        }
                        return pageDraft(updated, key);
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Could not add page');
                    }
                },
            }),
            import: createControllerMethod({
                path: '/import', type: 'post',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const parsed = importBody.safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid import request');
                    if (workspaceId() !== 'default' && !workspaceContext()?.siteId) throw errorHandler(HttpStatus.BadRequest, 'Create and select a site before installation');
                    try {
                        return await withWorkspaceCreation({ kind: 'preset-import', resourceId: workspaceContext()?.siteId || 'default' }, () => importPreset(parsed.data, importSource()));
                    } catch (cause) {
                        const message = cause instanceof Error ? cause.message : 'Import failed';
                        throw errorHandler(HttpStatus.BadRequest, message);
                    }
                },
            }),
        };
    },
});
