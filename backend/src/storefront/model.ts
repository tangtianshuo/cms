import { z } from 'zod';
import type { Template } from '../template/models/main';
import { PropType } from '../prop/models/main';

const sectionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('product-gallery'), source: z.literal('product.images') }).strict(),
    z.object({
        type: z.literal('product-information'),
        fields: z.array(z.enum(['name', 'price', 'description'])).min(1),
        specifications: z.array(z.object({ label: z.string().min(1), value: z.string() })).optional(),
        relatedProducts: z.array(z.string()).optional(),
        cta: z.object({ label: z.string().min(1), href: z.string().startsWith('/') }).optional(),
    }).strict(),
    z.object({ type: z.literal('product-description'), source: z.literal('product.description') }).strict(),
    z.object({ type: z.literal('faq'), items: z.array(z.object({ question: z.string(), answer: z.string() })).min(1) }).strict(),
]);

const pageConfigSchema = z.object({
    schemaVersion: z.literal(1),
    pageType: z.literal('product-detail'),
    bindings: z.object({
        name: z.string().min(1),
        price: z.string().min(1),
        description: z.string().min(1),
        images: z.string().min(1),
    }).strict(),
    sections: z.array(sectionSchema).min(1),
}).strict();

export type ProductPageConfig = z.infer<typeof pageConfigSchema>;

export interface StorefrontProduct {
    slug: string;
    name: string;
    price: number;
    description: string;
    images: Array<{ src: string; alt: string }>;
    relatedProducts?: Array<{ slug: string; name: string; image?: string }>;
}

export interface StorefrontPage {
    site: { name: string; language: string; currency: string };
    config: ProductPageConfig;
    product: StorefrontProduct;
}

export function parseProductPageConfig(input: unknown, template: Template): ProductPageConfig {
    const config = pageConfigSchema.parse(input);
    const requiredTypes: Record<keyof ProductPageConfig['bindings'], { type: PropType; array: boolean }> = {
        name: { type: PropType.STRING, array: false },
        price: { type: PropType.NUMBER, array: false },
        description: { type: PropType.STRING, array: false },
        images: { type: PropType.MEDIA, array: true },
    };
    for (const key of Object.keys(requiredTypes) as Array<keyof typeof requiredTypes>) {
        const prop = template.props.find((item) => item.id === config.bindings[key]);
        const required = requiredTypes[key];
        if (!prop || prop.type !== required.type || prop.array !== required.array) {
            throw new Error(`Invalid ${key} binding for product template`);
        }
    }
    const information = config.sections.find((section) => section.type === 'product-information');
    if (!information || !information.fields.includes('name') || !information.fields.includes('price')) {
        throw new Error('Product information must include name and price');
    }
    const types = config.sections.map((section) => section.type);
    if (new Set(types).size !== types.length) {
        throw new Error('Duplicate product sections are not supported');
    }
    return config;
}

export function createDefaultPageConfig(template: Template): ProductPageConfig {
    function fieldId(name: string): string {
        const prop = template.props.find((item) => item.name === name);
        if (!prop) {
            throw new Error(`Product template is missing ${name}`);
        }
        return prop.id;
    }
    return parseProductPageConfig({
        schemaVersion: 1,
        pageType: 'product-detail',
        bindings: {
            name: fieldId('title'),
            price: fieldId('price'),
            description: fieldId('description'),
            images: fieldId('images'),
        },
        sections: [
            { type: 'product-gallery', source: 'product.images' },
            { type: 'product-information', fields: ['name', 'price'] },
            { type: 'product-description', source: 'product.description' },
        ],
    }, template);
}
