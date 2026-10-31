import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { canReadContent, workspaceContext, workspaceId } from '../workspaces/context';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Repo } from '../repo';
import { Config } from '../config';
import { RP } from '../security/route-protection/main';
import { LanguageFactory } from '../language/factory';
import { buildChecklist } from './checklist';
import { getPreset, listPresets } from './catalog';
import { adoptPublicTemplate, importPreset, planImport, previewPublicTemplateUpgrade, type ImportSource } from './import';
import { getPublicRegistry, getPublicTemplate } from './registry';
import { createPageDraft, pageDraft, pageSectionOptions, updatePageDraft } from './pages';
import { gatewayBound, gatewayPublishConfig } from './gateway-publish';
import { buildSiteOperationsStatus } from './operations';
import { ownerWorkspace } from '../workspaces/context';
import { validateSectionMediaReferences } from '../storefront/section-schema';

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
    sectionConfigs: z.array(z.object({ type: z.enum(['hero-carousel', 'info-grid', 'faq', 'product-gallery', 'product-information', 'product-description']), enabled: z.boolean(), data: z.record(z.unknown()) }).strict()).optional(),
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
            upgrade: createControllerMethod({
                path: '/upgrade/:presetId', type: 'get', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const version = (request.query as { version?: string })?.version;
                    if (!version) throw errorHandler(HttpStatus.BadRequest, 'Template version is required');
                    const selected = await getPublicTemplate(presetId, version, globalThis.fetch);
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!selected || !site) throw errorHandler(HttpStatus.NotFound, 'Template upgrade is unavailable');
                    try { return previewPublicTemplateUpgrade(site, selected); }
                    catch (cause) { throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Template upgrade is unavailable'); }
                },
            }),
            site: createControllerMethod({
                path: '/site', type: 'get',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler() { return siteView(); },
            }),
            operations: createControllerMethod({
                path: '/operations', type: 'get',
                preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    if (!site) return { scope: { workspaceId: workspaceId(), siteId: '' }, site: null };
                    const domains = await Repo.siteDomain.methods.list(site._id);
                    const config = gatewayPublishConfig();
                    const bound = gatewayBound(site, config);
                    let gatewayStatus: 'ready' | 'pending' | 'failed' | 'unknown' = 'unknown';
                    if (site.gatewayPublishIntent) {
                        try {
                            const intent = JSON.parse(site.gatewayPublishIntent) as { status?: string };
                            gatewayStatus = intent.status === 'ready' || intent.status === 'pending' || intent.status === 'failed' ? intent.status : 'unknown';
                        } catch { gatewayStatus = 'failed'; }
                    }
                    const ids = bound ? site.gatewayPublishedReleaseIds || [] : site.publishedReleaseIds || [];
                    const releases = (await Repo.storefrontRelease.methods.findBySite(site._id)).filter((item) => ids.includes(item._id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
                    return buildSiteOperationsStatus({ workspaceId: ownerWorkspace(site), site, domains,
                        gateway: { configured: bound, status: gatewayStatus, activeRevision: site.gatewayActiveRevision, authoritative: false }, storefrontEnabled: Config.storefrontEnabled,
                        storefrontHealth: 'unknown',
                        recentPublishes: releases.map((item) => ({ _id: item._id, createdAt: item.createdAt, status: 'published' })),
                    });
                },
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
                    if (boundEntry && boundEntry.siteId !== site._id) {
                        throw errorHandler(HttpStatus.BadRequest, 'Page Entry belongs to another site');
                    }
                    if (parsed.data.sectionConfigs) {
                        const draft = pageDraft(site, pageKey)!;
                        validateSectionMediaReferences(draft.layout, parsed.data.sectionConfigs as never, {
                            media: await Repo.media.findAll(), site,
                            publishedPaths: new Set(site.pages.filter(page => page.enabled !== false && !page.path.includes(':')).map(page => page.path)),
                        });
                    }
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
                        if (!bound || bound.siteId !== site._id) throw new Error('Page Entry belongs to another site');
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
