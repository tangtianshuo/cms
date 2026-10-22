import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { Media } from '../media/models/main';
import type { PropValue } from '../prop/models/main';
import { parseProductPageConfig, type ProductPageConfig, type StorefrontProduct } from './model';

function propValue(entry: Entry, language: string, propId: string): PropValue['data'] | undefined {
    return entry.meta.find((meta) => meta.lng === language)?.props.find((prop) => prop.id === propId)?.data;
}

export function productEntrySlug(entry: Entry, template: Template, language: string): string | null {
    const slugId = template.props.find((prop) => prop.name === 'slug')?.id;
    if (!slugId) {
        return null;
    }
    const value = propValue(entry, language, slugId);
    return Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()
        ? value[0].trim()
        : null;
}

export function mapProduct(
    entry: Entry,
    template: Template,
    media: Media[],
    language: string,
    config: ProductPageConfig,
    mediaOrigin: string,
): StorefrontProduct {
    if (template.name !== 'product' || entry.templateId !== template._id) {
        throw new Error('Entry does not belong to the product template');
    }
    parseProductPageConfig(config, template);
    const slug = productEntrySlug(entry, template, language);
    const nameData = propValue(entry, language, config.bindings.name);
    const priceData = propValue(entry, language, config.bindings.price);
    const descriptionData = propValue(entry, language, config.bindings.description);
    const imageData = propValue(entry, language, config.bindings.images);
    const name = Array.isArray(nameData) && typeof nameData[0] === 'string' ? nameData[0].trim() : '';
    const price = Array.isArray(priceData) && typeof priceData[0] === 'number' ? priceData[0] : NaN;
    const description = Array.isArray(descriptionData) && typeof descriptionData[0] === 'string'
        ? descriptionData[0].trim()
        : '';
    if (!slug || !name || !Number.isFinite(price) || price < 0) {
        throw new Error('Product requires a slug, name, and non-negative price');
    }
    const publicOrigin = new URL(mediaOrigin).origin;
    const images: StorefrontProduct['images'] = [];
    if (Array.isArray(imageData)) {
        for (const item of imageData) {
            if (!item || typeof item !== 'object' || !('_id' in item) || typeof item._id !== 'string') {
                continue;
            }
            const found = media.find((candidate) => candidate._id === item._id);
            if (!found || !found.mimetype.startsWith('image/')) {
                continue;
            }
            images.push({
                src: `${publicOrigin}/api/v4/media/${encodeURIComponent(found._id)}/bin/image`,
                alt: 'alt_text' in item && typeof item.alt_text === 'string' && item.alt_text.trim()
                    ? item.alt_text.trim()
                    : found.altText || name,
            });
        }
    }
    return { slug, name, price, description, images };
}
