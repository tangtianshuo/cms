import { v4 as uuidv4 } from 'uuid';
import type { Template } from '../template/models/main';
import { TemplateFactory } from '../template/factory';
import { PropType, type Prop } from '../prop/models/main';

interface TemplateSource {
    findByName(name: string): Promise<Template | null>;
    add(template: Template): Promise<Template>;
}

export async function ensureProductTemplate(enabled: boolean, source: TemplateSource): Promise<Template | null> {
    if (!enabled) {
        return null;
    }
    const existing = await source.findByName('product');
    if (existing) {
        return existing;
    }
    function prop(name: string, label: string, type: PropType, required: boolean, array: boolean): Prop {
        return { id: uuidv4(), name, label, type, required, array, data: {} };
    }
    const template = TemplateFactory.create({
        name: 'product',
        label: 'Product',
        desc: 'Storefront product details',
        userId: '__storefront',
        singleEntry: false,
        props: [
            prop('title', 'Product name', PropType.STRING, true, false),
            prop('slug', 'Slug', PropType.STRING, true, false),
            prop('price', 'Price', PropType.NUMBER, true, false),
            prop('description', 'Description', PropType.STRING, false, false),
            prop('images', 'Images', PropType.MEDIA, false, true),
        ],
    });
    return source.add(template);
}
