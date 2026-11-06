import type { TemplateEditorContract, TemplateSectionProperty } from '../template-contract/model';
import type { Media } from '../media/models/main';
import { mediaReferenceAllowedForSite } from '../_utils/site-media';
import type { SiteInstallation } from '../presets/site-model';

export type MediaRef = { _id: string };

export type SectionType = 'hero-carousel' | 'info-grid' | 'faq' | 'product-gallery' | 'product-information' | 'product-description';

export interface SectionConfig {
    type: SectionType;
    enabled: boolean;
    data: Record<string, unknown>;
}

const allowedByLayout: Record<string, SectionType[]> = {
    home: ['hero-carousel', 'info-grid', 'faq'],
    'collection-list': ['info-grid', 'faq'],
    'product-detail': ['product-gallery', 'product-information', 'product-description', 'faq'],
    'content-page': ['info-grid', 'faq'],
};

const requiredByLayout: Record<string, SectionType[]> = {
    home: ['hero-carousel'],
    'product-detail': ['product-gallery', 'product-information', 'product-description'],
};

function mediaRef(value: unknown): value is MediaRef {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
        typeof (value as MediaRef)._id === 'string' && (value as MediaRef)._id.length > 0);
}

export function mediaAuthorizedForSite(media: Pick<Media, '_id' | 'mimetype' | 'workspaceId'> & { siteId?: string }, site: Pick<SiteInstallation, '_id' | 'workspaceId'>, options: { requireSiteBinding?: boolean } = {}): boolean {
    if (!mediaReferenceAllowedForSite(media, site, options)) return false;
    return typeof media.mimetype === 'string' && media.mimetype.startsWith('image/');
}

function sectionMediaIds(section: SectionConfig): string[] {
    if (!section.enabled) return [];
    const data = section.data;
    if (section.type === 'hero-carousel' && Array.isArray(data.slides)) {
        return data.slides.flatMap(item => mediaRef((item as Record<string, unknown>)?.image) ? [(item as Record<string, unknown>).image as MediaRef] : []).map(item => item._id);
    }
    if (section.type === 'product-gallery' && Array.isArray(data.images)) {
        return data.images.flatMap(item => mediaRef(item) ? [item] : []).map(item => item._id);
    }
    return [];
}

export function validateSectionMediaReferences(layout: string, sections: SectionConfig[], options: {
    publishedPaths?: Set<string>;
    media: readonly Media[];
    site: Pick<SiteInstallation, '_id' | 'workspaceId'>;
}): void {
    validateSectionConfigs(layout, sections, { publishedPaths: options.publishedPaths });
    const byId = new Map(options.media.map(item => [item._id, item]));
    for (const section of sections) for (const id of sectionMediaIds(section)) {
        const media = byId.get(id);
        if (!media || !mediaAuthorizedForSite(media, options.site, { requireSiteBinding: true })) throw new Error(`Section media is not available for this site: ${id}`);
    }
}

function validHref(value: unknown, publishedPaths?: Set<string>): boolean {
    if (typeof value !== 'string') return false;
    if (!value.startsWith('/')) {
        try { return ['https:', 'http:'].includes(new URL(value).protocol); }
        catch { return false; }
    }
    if (value.startsWith('//') || value.includes('\\')) return false;
    return !publishedPaths || publishedPaths.has(value);
}

function validateData(section: SectionConfig, publishedPaths?: Set<string>): void {
    const data = section.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid section data');
    if (!section.enabled) return;
    if (section.type === 'hero-carousel') {
        if (!Array.isArray(data.slides) || data.slides.length === 0) throw new Error('Hero carousel requires slides');
        const orders = new Set<number>();
        for (const slide of data.slides) {
            if (!slide || typeof slide !== 'object' || Array.isArray(slide)) throw new Error('Invalid carousel slide');
            const item = slide as Record<string, unknown>;
            if (!mediaRef(item.image) || typeof item.order !== 'number' || !Number.isInteger(item.order) || orders.has(item.order)) {
                throw new Error('Invalid carousel slide order or media');
            }
            orders.add(item.order);
            if (item.cta !== undefined) {
                if (!item.cta || typeof item.cta !== 'object' || !validHref((item.cta as Record<string, unknown>).href, publishedPaths)) {
                    throw new Error('Invalid carousel internal link');
                }
            }
        }
    } else if (section.type === 'info-grid') {
        if (!Array.isArray(data.items) || data.items.some(item => !item || typeof item !== 'object')) throw new Error('Invalid info grid');
    } else if (section.type === 'faq') {
        if (!Array.isArray(data.items) || data.items.some(item => !item || typeof item !== 'object' || typeof (item as Record<string, unknown>).question !== 'string' || typeof (item as Record<string, unknown>).answer !== 'string')) {
            throw new Error('Invalid FAQ section');
        }
    } else if (section.type === 'product-gallery') {
        if (!Array.isArray(data.images) || data.images.length === 0 || data.images.some(item => !mediaRef(item))) throw new Error('Invalid product gallery');
    } else if (section.type === 'product-information') {
        if (data.specifications !== undefined && (!Array.isArray(data.specifications) || data.specifications.some(item => !item || typeof item !== 'object'))) throw new Error('Invalid product specifications');
        if (data.relatedProducts !== undefined && (!Array.isArray(data.relatedProducts) || data.relatedProducts.some(item => typeof item !== 'string'))) throw new Error('Invalid related products');
    } else if (section.type === 'product-description' && data.body !== undefined && typeof data.body !== 'string') {
        throw new Error('Invalid product description');
    }
}

export function validateSectionConfigs(layout: string, sections: SectionConfig[], options: { publishedPaths?: Set<string> } = {}): void {
    const allowed = allowedByLayout[layout];
    if (!allowed || !Array.isArray(sections) || sections.length === 0) throw new Error('Invalid section list');
    const types = new Set<SectionType>();
    for (const section of sections) {
        if (!section || !allowed.includes(section.type) || typeof section.enabled !== 'boolean' || types.has(section.type)) throw new Error('Invalid or duplicate section');
        types.add(section.type);
        validateData(section, options.publishedPaths);
    }
    for (const required of requiredByLayout[layout] || []) if (!types.has(required)) throw new Error(`Required section missing: ${required}`);
}

export function normalizeSectionConfigs(layout: string, sections: SectionConfig[], options: { publishedPaths?: Set<string> } = {}): SectionConfig[] {
    validateSectionConfigs(layout, sections, options);
    return sections.map(section => ({ ...section, data: structuredClone(section.data) }));
}

export function legacySections(_layout: string, sections: string[] = []): SectionConfig[] {
    const mapping: Record<string, SectionType> = {
        hero: 'hero-carousel', feature: 'info-grid', gallery: 'product-gallery', information: 'product-information', description: 'product-description',
    };
    const types = sections.map(item => mapping[item]).filter((item): item is SectionType => Boolean(item));
    if (types.length === 0) return [];
    return types.map(type => ({ type, enabled: true, data: type === 'hero-carousel' ? { slides: [] } : type === 'product-gallery' ? { images: [] } : {} }));
}

/** Validate scalar declarations without rewriting preserved complex or hidden values. */
export function validateDeclaredSectionValues(props: Record<string, unknown>, declared: Record<string, TemplateSectionProperty>, enabled = true): void {
    for (const [key, field] of Object.entries(declared)) {
        const value = props[key] ?? field.default;
        const visible = !field.visibleWhen || JSON.stringify(props[field.visibleWhen.field] ?? declared[field.visibleWhen.field]?.default) === JSON.stringify(field.visibleWhen.equals);
        const empty = value === undefined || value === null || typeof value === 'string' && !value.trim();
        const label = field.label || field.description || key;
        if (field.required && enabled && visible && empty) throw new Error(`${label}: 请填写内容`);
        if (empty) continue;
        if (field.control === 'text' && /href$/i.test(key) && (typeof value !== 'string' || !/^(?:https?:\/\/|\/(?!\/))/.test(value) || value.includes('\\'))) throw new Error(`${label}: 请输入有效的网站路径或网址`);
        if (field.control === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${label}: 请输入有效数字`);
        if (field.control === 'number' && typeof value === 'number' && field.minimum !== undefined && value < field.minimum) throw new Error(`${label}: 请输入不小于${field.minimum}的数字`);
        if (field.control === 'number' && field.integer && !Number.isInteger(value)) throw new Error(`${label}: 请输入整数`);
        if (field.control === 'boolean' && typeof value !== 'boolean' || field.control === 'text' && typeof value !== 'string') throw new Error(`${label}: 内容格式无效`);
        if (field.control === 'enum' && !field.options?.includes(value as string)) throw new Error(`${label}: 请选择列表中的选项`);
        if (field.control === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error(`${label}: 请选择有效日期`);
    }
}
export function validateDeclaredSectionProperties(configs: Array<{ type: string; enabled: boolean; data: Record<string, unknown> }>, sections: TemplateEditorContract['sections'], options: {
    media: readonly Media[]; site: Pick<SiteInstallation, '_id' | 'workspaceId'>; referenceIds?: Set<string>;
}): void {
    for (const section of configs) {
        const declared = sections.find(item => item.type === section.type)?.props || {};
        validateDeclaredSectionValues(section.data, declared, section.enabled);
        for (const [key, field] of Object.entries(declared)) {
            const value = section.data[key];
            if (value === undefined || value === null || value === '') continue;
            if (field.control === 'media') {
                let id: string | undefined;
                if (typeof value === 'string') {
                    if (!/^(?:https?:\/\/|\/(?!\/))/.test(value) || value.includes('\\')) throw new Error(`${key}: 请选择可访问的图片`);
                    try { const match = /^\/api\/v4\/media\/([^/]+)\/bin\//.exec(new URL(value, 'https://media.invalid').pathname); if (match) id = decodeURIComponent(match[1]); } catch { throw new Error(`${key}: 图片地址无效`); }
                } else if (mediaRef(value) && Object.keys(value).length === 1) id = value._id;
                else throw new Error(`${key}: 请选择可访问的图片`);
                if (id) {
                    const media = options.media.find(item => item._id === id);
                    if (!media || !mediaAuthorizedForSite(media, options.site, { requireSiteBinding: true })) throw new Error(`${key}: 图片不可用于当前网站`);
                }
            }
            if (field.control === 'reference') {
                const id = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? (value as { eid?: unknown }).eid : undefined;
                if (typeof id !== 'string' || !options.referenceIds?.has(id)) throw new Error(`${key}: 内容引用不可用于当前网站`);
            }
        }
    }
}
