import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { canReadContent, workspaceContext, workspaceId } from '../workspaces/context';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import { LanguageFactory } from '../language/factory';
import { buildChecklist } from './checklist';
import { getPreset, listPresets } from './catalog';
import { adoptPublicTemplate, importPreset, planImport, type ImportSource } from './import';
import { getPublicRegistry, getPublicTemplate } from './registry';
import { createPageDraft, pageDraft, pageSectionOptions, updatePageDraft } from './pages';
import { gatewayBound, gatewayPublishConfig } from './gateway-publish';

const importBody = z.object({
    presetId: z.string().min(1),
    presetVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    manifestChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    siteName: z.string().trim().min(1).max(80).optional(),
    includeDemo: z.boolean().optional(),
    mode: z.enum(['import', 'adopt']).optional(),
    expectedUpdatedAt: z.number().int().nonnegative().optional(),
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
        async ensureEnglish() {
            if (await Repo.language.methods.findByCode('en')) return;
            await Repo.language.add(LanguageFactory.create({
                code: 'en', name: 'English', nativeName: 'English', userId: '__preset',
                default: (await Repo.language.findAll()).length === 0,
            }));
        },
    };
}

async function siteView() {
    const site = await Repo.siteInstallation.methods.findSelected();
    if (!site) return { site: null, checklist: [], pageOptions: {} };
    let gatewayReady = false;
    if (gatewayBound(site, gatewayPublishConfig()) && site.gatewayPublishIntent) {
        try { gatewayReady = JSON.parse(site.gatewayPublishIntent).status === 'ready'; } catch { /* malformed intent is not a successful publication */ }
    }
    const templates: Parameters<typeof buildChecklist>[1] = {};
    const entries: Parameters<typeof buildChecklist>[2] = {};
    for (const model of site.models) {
        templates[model.key] = (await Repo.template.findById(model.templateId)) || undefined;
        entries[model.key] = await Repo.entry.methods.findAllByTemplateId(model.templateId);
    }
    return {
        site: { ...site, pages: site.pages.map((page) => pageDraft(site, page.key)) },
        checklist: buildChecklist(site, templates, entries, gatewayReady),
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
                async handler() {
                    try {
                        const registry = await getPublicRegistry(globalThis.fetch);
                        const publicItems = registry.records.map((record) => ({
                            id: record.id, version: record.version, name: record.manifest.name,
                            description: record.manifest.description, theme: record.manifest.theme,
                            heroImage: record.manifest.demo.hero.image, sourceCommit: record.sourceCommit,
                            manifestChecksum: record.manifestChecksum, imageDigest: record.imageDigest,
                            imageRepository: record.imageRepository,
                        }));
                        return { items: [...listPresets().filter((item) => !publicItems.some((publicItem) => publicItem.id === item.id && publicItem.version === item.version)), ...publicItems],
                            publicRegistryAvailable: true, registryError: '' };
                    } catch (cause) {
                        return { items: listPresets(), publicRegistryAvailable: false,
                            registryError: cause instanceof Error ? cause.message : 'Public template registry unavailable' };
                    }
                },
            }),
            manifest: createControllerMethod({
                path: '/catalog/:presetId', type: 'get',
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const version = (request.query as { version?: string })?.version;
                    const publicTemplate = version ? await getPublicTemplate(presetId, version, globalThis.fetch) : null;
                    const preset = publicTemplate?.manifest || getPreset(presetId, version);
                    if (!preset) throw errorHandler(HttpStatus.NotFound, 'Preset not found');
                    return preset;
                },
            }),
            plan: createControllerMethod({
                path: '/plan/:presetId', type: 'get',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const version = (request.query as { version?: string })?.version;
                    const publicTemplate = version ? await getPublicTemplate(presetId, version, globalThis.fetch) : null;
                    const preset = publicTemplate?.manifest || getPreset(presetId, version);
                    if (!preset) throw errorHandler(HttpStatus.NotFound, 'Preset not found');
                    const plan = await planImport(preset, importSource());
                    if (publicTemplate) Object.assign(plan, { manifestChecksum: publicTemplate.manifestChecksum,
                        sourceCommit: publicTemplate.sourceCommit, imageDigest: publicTemplate.imageDigest });
                    return {
                        plan,
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
                async handler({ request, errorHandler }) {
                    const { templateId } = request.params as { templateId: string };
                    if (!canReadContent('Template', { _id: templateId })) {
                        throw errorHandler(HttpStatus.Forbidden, 'Template access denied');
                    }
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
                    if (!parsed.success || (parsed.data.mode === 'adopt' && (!parsed.data.presetVersion || parsed.data.expectedUpdatedAt === undefined)) ||
                        (parsed.data.mode !== 'adopt' && !parsed.data.siteName)) throw errorHandler(HttpStatus.BadRequest, 'Invalid import request');
                    if (workspaceId() !== 'default' && !workspaceContext()?.siteId) throw errorHandler(HttpStatus.BadRequest, 'Create and select a site before installation');
                    try {
                        const mode = parsed.data.mode || 'import';
                        const selected = parsed.data.presetVersion ? await getPublicTemplate(parsed.data.presetId, parsed.data.presetVersion, globalThis.fetch) : null;
                        if (parsed.data.presetVersion && (!selected || selected.manifestChecksum !== parsed.data.manifestChecksum)) {
                            throw new Error('Public template version changed; refresh the catalog');
                        }
                        if (mode === 'adopt') {
                            if (!selected) throw new Error('Only verified public versions can be adopted');
                            return await adoptPublicTemplate({ presetId: parsed.data.presetId, presetVersion: parsed.data.presetVersion!,
                                expectedUpdatedAt: parsed.data.expectedUpdatedAt! }, importSource(), selected);
                        }
                        return await withWorkspaceCreation({ kind: 'preset-import', resourceId: workspaceContext()?.siteId || 'default' }, () =>
                            importPreset({ presetId: parsed.data.presetId, presetVersion: parsed.data.presetVersion,
                                siteName: parsed.data.siteName!, includeDemo: parsed.data.includeDemo ?? false }, importSource(), selected || undefined));
                    } catch (cause) {
                        const message = cause instanceof Error ? cause.message : 'Import failed';
                        throw errorHandler(HttpStatus.BadRequest, message);
                    }
                },
            }),
        };
    },
});
