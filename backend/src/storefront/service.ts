import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { Media } from '../media/models/main';
import {
    createDefaultPageConfig,
    parseProductPageConfig,
    type StorefrontPage,
} from './model';
import { mapProduct, productEntrySlug } from './product';

export interface DevelopmentSite {
    name: string;
    host: string;
    language: string;
    currency: string;
    mediaOrigin: string;
}

export interface ProductSources {
    findTemplate(): Promise<Template | null>;
    findEntries(templateId: string): Promise<Entry[]>;
    findMedia(): Promise<Media[]>;
}

export async function getProductPage(
    slug: string,
    host: string,
    site: DevelopmentSite,
    sources: ProductSources,
): Promise<StorefrontPage | null> {
    if (host.toLowerCase() !== site.host.toLowerCase()) {
        return null;
    }
    const template = await sources.findTemplate();
    if (!template) {
        return null;
    }
    const entries = await sources.findEntries(template._id);
    const entry = entries.find((item) => item.userId !== '__preset' &&
        productEntrySlug(item, template, site.language) === slug);
    if (!entry) {
        return null;
    }
    return previewProductPage(entry, site, template, await sources.findMedia());
}

export async function previewProductPage(
    entry: Entry,
    site: DevelopmentSite,
    template: Template,
    media: Media[],
    configInput?: unknown,
): Promise<StorefrontPage> {
    const config = configInput === undefined
        ? createDefaultPageConfig(template)
        : parseProductPageConfig(configInput, template);
    return {
        site: {
            name: site.name,
            language: site.language,
            currency: site.currency,
        },
        config,
        product: mapProduct(entry, template, media, site.language, config, site.mediaOrigin),
    };
}
