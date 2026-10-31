import type { Media } from '../media/models/main';
import { ownerWorkspace } from '../workspaces/context';
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
    if (ownerWorkspace(media) !== ownerWorkspace(site)) return false;
    if (media.siteId && media.siteId !== site._id) return false;
    if (options.requireSiteBinding && media.siteId !== site._id) return false;
    // Non-default workspaces have site-bound media after the media repository
    // stamps the selected site. Missing provenance cannot be accepted there.
    if (ownerWorkspace(site) !== 'default' && media.siteId !== site._id) return false;
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
