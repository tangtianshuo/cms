import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import { buildChecklist } from './checklist';
import { getPreset, listPresets } from './catalog';
import { importPreset, planImport, type ImportSource } from './import';

const importBody = z.object({
    presetId: z.string().min(1),
    siteName: z.string().trim().min(1).max(80),
    includeDemo: z.boolean(),
}).strict();

function importSource(): ImportSource {
    return {
        findSite: () => Repo.siteInstallation.methods.findDefault(),
        addSite: (site) => Repo.siteInstallation.add(site),
        updateSite: (site) => Repo.siteInstallation.update(site),
        findTemplate: (name) => Repo.template.methods.findByName(name),
        addTemplate: (template) => Repo.template.add(template),
        updateTemplate: (template) => Repo.template.update(template),
        findEntry: (id) => Repo.entry.findById(id),
        addEntry: (entry) => Repo.entry.add(entry),
        language: async () => (await Repo.language.findAll())[0]?.code || 'en',
    };
}

async function siteView() {
    const site = await Repo.siteInstallation.methods.findDefault();
    if (!site) return { site: null, checklist: [] };
    const templates: Parameters<typeof buildChecklist>[1] = {};
    const entries: Parameters<typeof buildChecklist>[2] = {};
    for (const model of site.models) {
        templates[model.key] = (await Repo.template.findById(model.templateId)) || undefined;
        entries[model.key] = await Repo.entry.methods.findAllByTemplateId(model.templateId);
    }
    return { site, checklist: buildChecklist(site, templates, entries) };
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
                preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ request, errorHandler }) {
                    const { presetId } = request.params as { presetId: string };
                    const preset = getPreset(presetId);
                    if (!preset) throw errorHandler(HttpStatus.NotFound, 'Preset not found');
                    return {
                        plan: await planImport(preset, importSource()),
                        installedSite: await Repo.siteInstallation.methods.findDefault(),
                    };
                },
            }),
            site: createControllerMethod({
                path: '/site', type: 'get',
                preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler() { return siteView(); },
            }),
            import: createControllerMethod({
                path: '/import', type: 'post',
                preRequestHandler: RP.createJwtCheck(['ADMIN']),
                async handler({ request, errorHandler }) {
                    const parsed = importBody.safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid import request');
                    try {
                        return await importPreset(parsed.data, importSource());
                    } catch (cause) {
                        const message = cause instanceof Error ? cause.message : 'Import failed';
                        throw errorHandler(HttpStatus.BadRequest, message);
                    }
                },
            }),
        };
    },
});
