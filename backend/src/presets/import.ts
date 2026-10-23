import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import type { Entry } from '../entry/models/main';
import { EntryFactory } from '../entry/factory';
import { PropType, type Prop, type PropValue } from '../prop/models/main';
import { PropFactory } from '../prop/factory';
import type { PropValueRichTextData } from '../prop/models/rich-text';
import type { Template } from '../template/models/main';
import { TemplateFactory } from '../template/factory';
import { getPreset, type PresetField, type PresetManifest, type PresetModel } from './catalog';
import type { SiteInstallation } from './site-model';

export interface ImportSource {
    findSite(): Promise<SiteInstallation | null>;
    addSite(site: SiteInstallation): Promise<SiteInstallation>;
    updateSite(site: SiteInstallation): Promise<SiteInstallation>;
    findTemplate(name: string): Promise<Template | null>;
    addTemplate(template: Template): Promise<Template>;
    updateTemplate(template: Template): Promise<Template>;
    findEntry(id: string): Promise<Entry | null>;
    addEntry(entry: Entry): Promise<Entry>;
    language(): Promise<string>;
}

export interface ImportPlan {
    presetId: string;
    version: string;
    models: Array<{ key: string; name: string; action: 'create' | 'reuse' | 'update' | 'conflict'; reason?: string }>;
    pages: PresetManifest['pages'];
}

export function templateName(key: string): string {
    return key === 'product' ? 'product' : `storefront-${key}`;
}

function compatibility(model: PresetModel, existing: Template): { action: 'reuse' | 'update' | 'conflict'; reason?: string } {
    if (existing.userId !== '__storefront' && existing.userId !== '__preset') {
        return { action: 'conflict', reason: 'Template name belongs to another owner' };
    }
    if (existing.singleEntry !== model.singleEntry) {
        return { action: 'conflict', reason: 'Single-entry setting differs' };
    }
    for (const field of model.fields) {
        const prop = existing.props.find((item) => item.name === field.key);
        if (prop && (prop.type !== field.type || prop.array !== field.array || prop.required !== field.required)) {
            return { action: 'conflict', reason: `Field ${field.key} is incompatible` };
        }
    }
    return model.fields.some((field) => !existing.props.some((prop) => prop.name === field.key))
        ? { action: 'update' }
        : { action: 'reuse' };
}

export async function planImport(preset: PresetManifest, source: ImportSource): Promise<ImportPlan> {
    const models: ImportPlan['models'] = [];
    for (const model of preset.models) {
        const name = templateName(model.key);
        const existing = await source.findTemplate(name);
        models.push({ key: model.key, name, ...(existing ? compatibility(model, existing) : { action: 'create' as const }) });
    }
    return { presetId: preset.id, version: preset.version, models, pages: preset.pages };
}

function propFor(field: PresetField, templates: Map<string, Template>): Prop {
    const data: Prop['data'] = PropFactory.create(field.type, field.array)?.data || {};
    if (field.type === PropType.ENTRY_POINTER && field.referenceModel) {
        const target = templates.get(field.referenceModel);
        const displayProp = target?.props.find((prop) => prop.name === 'title');
        if (!target || !displayProp) throw new Error(`Missing reference model ${field.referenceModel}`);
        data.propEntryPointer = [{ templateId: target._id, entryIds: [], displayProp: displayProp.id }];
    }
    return {
        id: uuidv4(), name: field.key, label: field.label, type: field.type,
        required: field.required, array: field.array, data,
    };
}

function demoEntryId(siteId: string, modelKey: string): string {
    return createHash('sha256').update(`${siteId}:${modelKey}:demo`).digest('hex').slice(0, 24);
}

function demoValues(preset: PresetManifest, siteName: string): Record<string, Record<string, string | number>> {
    return {
        product: { title: preset.demo.product.title, slug: 'featured-product', price: Number(preset.demo.product.price.replace(/[^\d.]/g, '')), description: preset.demo.product.description },
        collection: { title: preset.demo.collection.title, slug: 'featured-collection', description: preset.demo.collection.description },
        home: { title: 'Home', slug: 'home', headline: preset.demo.hero.title, intro: preset.demo.hero.subtitle },
        'content-page': { title: preset.demo.page.title, slug: 'about', summary: preset.demo.page.body, body: preset.demo.page.body, seoDescription: preset.demo.page.body },
        'site-settings': { title: 'Site settings', slug: 'settings', brandName: siteName },
    };
}

async function seedDemo(site: SiteInstallation, preset: PresetManifest, source: ImportSource): Promise<void> {
    const language = await source.language();
    const values = demoValues(preset, site.name);
    for (const model of preset.models) {
        const id = demoEntryId(site._id, model.key);
        if (await source.findEntry(id)) continue;
        const mapping = site.models.find((item) => item.key === model.key);
        if (!mapping) throw new Error(`Missing imported model ${model.key}`);
        const props: PropValue[] = model.fields.map((field) => {
            const propId = mapping.fields.find((item) => item.key === field.key)?.propId;
            if (!propId) throw new Error(`Missing field ${field.key}`);
            let data: PropValue['data'] = [];
            const scalar = values[model.key]?.[field.key];
            if (scalar !== undefined) data = [scalar] as string[] | number[];
            if (field.type === PropType.RICH_TEXT) {
                data = [{ nodes: scalar ? [{ type: 'paragraph', content: [{ type: 'text', text: String(scalar) }] }] : [] }] as PropValueRichTextData[];
            }
            if (field.type === PropType.ENTRY_POINTER && field.referenceModel) {
                const target = site.models.find((item) => item.key === field.referenceModel);
                if (!target) throw new Error(`Missing reference ${field.referenceModel}`);
                data = [{ tid: target.templateId, eid: demoEntryId(site._id, field.referenceModel) }];
            }
            return { id: propId, data };
        });
        const entry = EntryFactory.create({
            templateId: mapping.templateId, userId: '__preset', statuses: [],
            meta: [{ lng: language, props }], content: [{ lng: language, nodes: [], plainText: '' }],
        });
        entry._id = id;
        await source.addEntry(entry);
    }
}

export async function importPreset(
    input: { presetId: string; siteName: string; includeDemo: boolean }, source: ImportSource,
): Promise<SiteInstallation> {
    const preset = getPreset(input.presetId);
    if (!preset) throw new Error('Unknown preset');
    const siteName = input.siteName.trim();
    if (!siteName || siteName.length > 80) throw new Error('Site name must be 1-80 characters');
    const current = await source.findSite();
    if (current && current.presetId !== preset.id) throw new Error('Another preset is already installed');
    if (current?.status === 'ready') return current;
    if (current?.status === 'importing' && Date.now() - current.updatedAt < 120000) return current;
    const plan = await planImport(preset, source);
    if (plan.models.some((model) => model.action === 'conflict')) throw new Error('Template conflict prevents import');
    let site: SiteInstallation = current || {
        _id: new ObjectId().toString(), createdAt: Date.now(), updatedAt: Date.now(), slot: 'default',
        name: siteName, presetId: preset.id, presetVersion: preset.version, status: 'importing',
        importError: '', includeDemo: input.includeDemo, demoSeeded: false,
        theme: { ...preset.theme }, models: [],
        pages: preset.pages.map((page) => ({ ...page, status: 'draft' as const })),
    };
    if (current) {
        site = { ...current, status: 'importing', importError: '', updatedAt: Date.now() };
        site = await source.updateSite(site);
    } else {
        try {
            site = await source.addSite(site);
        } catch (cause) {
            if ((cause as { code?: number })?.code === 11000) {
                const winner = await source.findSite();
                if (winner?.presetId === preset.id) return winner;
            }
            throw cause;
        }
    }
    try {
        const templates = new Map<string, Template>();
        for (const model of preset.models) {
            const existing = await source.findTemplate(templateName(model.key));
            templates.set(model.key, existing ? structuredClone(existing) : TemplateFactory.create({
                name: templateName(model.key), label: model.label, desc: model.description,
                userId: '__preset', singleEntry: model.singleEntry, props: [],
            }));
        }
        for (const model of preset.models) {
            const template = templates.get(model.key) as Template;
            const title = model.fields[0];
            if (!template.props.some((prop) => prop.name === title.key)) {
                template.props.push(propFor(title, templates));
            }
        }
        for (const model of preset.models) {
            const template = templates.get(model.key) as Template;
            const existed = await source.findTemplate(template.name);
            for (const field of model.fields) {
                if (!template.props.some((prop) => prop.name === field.key)) {
                    template.props.push(propFor(field, templates));
                }
            }
            const saved = existed
                ? (template.props.length > existed.props.length ? await source.updateTemplate(template) : existed)
                : await source.addTemplate(template);
            const mapping = {
                key: model.key, templateId: saved._id,
                fields: model.fields.map((field) => {
                    const prop = saved.props.find((item) => item.name === field.key);
                    if (!prop) throw new Error(`Missing imported field ${field.key}`);
                    return { key: field.key, propId: prop.id };
                }),
            };
            site.models = [...site.models.filter((item) => item.key !== model.key), mapping];
            site = await source.updateSite(site);
        }
        if (site.includeDemo && !site.demoSeeded) {
            await seedDemo(site, preset, source);
            site.demoSeeded = true;
        }
        site.status = 'ready';
        site.importError = '';
        return await source.updateSite(site);
    } catch (error) {
        site.status = 'failed';
        site.importError = error instanceof Error ? error.message : String(error);
        await source.updateSite(site);
        throw error;
    }
}
