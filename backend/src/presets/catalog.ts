import { PropType } from '../prop/models/main';

export interface PresetField {
    key: string;
    label: string;
    type: PropType;
    required: boolean;
    array: boolean;
    referenceModel?: string;
}

export interface PresetModel {
    key: string;
    label: string;
    description: string;
    singleEntry: boolean;
    fields: PresetField[];
}

export interface PresetPage {
    key: string;
    title: string;
    path: string;
    modelKey: string;
    layout: string;
}

export interface PresetManifest {
    id: string;
    version: string;
    name: string;
    description: string;
    theme: {
        background: string;
        foreground: string;
        accent: string;
        muted: string;
        font: string;
    };
    models: PresetModel[];
    pages: PresetPage[];
    demo: {
        brand: string;
        hero: { title: string; subtitle: string; image: string };
        product: { title: string; price: string; image: string; description: string };
        collection: { title: string; description: string; image: string };
        page: { title: string; body: string; image: string };
    };
}

const field = (key: string, label: string, type: PropType, required = false, array = false,
    referenceModel?: string): PresetField => ({ key, label, type, required, array, referenceModel });

const models: PresetModel[] = [
    {
        key: 'product', label: 'Products', description: 'Catalog products', singleEntry: false,
        fields: [
            field('title', 'Title', PropType.STRING, true),
            field('slug', 'Slug', PropType.STRING, true),
            field('price', 'Price', PropType.NUMBER, true),
            field('description', 'Description', PropType.STRING),
            field('images', 'Images', PropType.MEDIA, false, true),
            field('sku', 'SKU', PropType.STRING),
        ],
    },
    {
        key: 'collection', label: 'Collections', description: 'Product collections', singleEntry: false,
        fields: [
            field('title', 'Title', PropType.STRING, true),
            field('slug', 'Slug', PropType.STRING, true),
            field('description', 'Description', PropType.STRING),
            field('cover', 'Cover', PropType.MEDIA),
            field('products', 'Products', PropType.ENTRY_POINTER, false, true, 'product'),
        ],
    },
    {
        key: 'home', label: 'Home page', description: 'Homepage content', singleEntry: true,
        fields: [
            field('title', 'Title', PropType.STRING, true),
            field('slug', 'Slug', PropType.STRING, true),
            field('headline', 'Headline', PropType.STRING, true),
            field('intro', 'Introduction', PropType.STRING),
            field('heroImage', 'Hero image', PropType.MEDIA),
            field('featuredCollections', 'Featured collections', PropType.ENTRY_POINTER, false, true, 'collection'),
            field('featuredProducts', 'Featured products', PropType.ENTRY_POINTER, false, true, 'product'),
        ],
    },
    {
        key: 'content-page', label: 'Pages', description: 'About, shipping and policy pages', singleEntry: false,
        fields: [
            field('title', 'Title', PropType.STRING, true),
            field('slug', 'Slug', PropType.STRING, true),
            field('summary', 'Summary', PropType.STRING),
            field('cover', 'Cover', PropType.MEDIA),
            field('body', 'Body', PropType.RICH_TEXT),
            field('seoDescription', 'SEO description', PropType.STRING),
        ],
    },
    {
        key: 'site-settings', label: 'Site settings', description: 'Shared brand and navigation', singleEntry: true,
        fields: [
            field('title', 'Title', PropType.STRING, true),
            field('slug', 'Slug', PropType.STRING, true),
            field('brandName', 'Brand name', PropType.STRING, true),
            field('logo', 'Logo', PropType.MEDIA),
            field('announcement', 'Announcement', PropType.STRING),
            field('contactEmail', 'Contact email', PropType.STRING),
            field('navigationPages', 'Navigation pages', PropType.ENTRY_POINTER, false, true, 'content-page'),
        ],
    },
];

const pages: PresetPage[] = [
    { key: 'home', title: 'Home', path: '/', modelKey: 'home', layout: 'home' },
    { key: 'collections', title: 'Collections', path: '/collections', modelKey: 'collection', layout: 'collection-list' },
    { key: 'product', title: 'Product detail', path: '/products/:slug', modelKey: 'product', layout: 'product-detail' },
    { key: 'content', title: 'Content page', path: '/pages/:slug', modelKey: 'content-page', layout: 'content-page' },
];

const presets: PresetManifest[] = [
    {
        id: 'atelier', version: '1.0.0', name: 'Atelier',
        description: 'Editorial product storytelling with generous imagery.',
        theme: { background: '#f5f4ef', foreground: '#212521', accent: '#176a58', muted: '#dfded6', font: 'Georgia, serif' },
        models, pages,
        demo: {
            brand: 'STUDIO FORM',
            hero: {
                title: 'Objects for everyday living',
                subtitle: 'Thoughtful pieces designed to stay with you.',
                image: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?w=1600&q=85',
            },
            product: {
                title: 'Everyday ceramic vase', price: '$68',
                image: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1200&q=85',
                description: 'A quietly sculptural piece for fresh stems or open shelves.',
            },
            collection: {
                title: 'The living collection', description: 'Considered details for rooms you use every day.',
                image: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1400&q=85',
            },
            page: {
                title: 'Our story', body: 'We believe the best spaces are built slowly, with pieces that feel personal.',
                image: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1400&q=85',
            },
        },
    },
    {
        id: 'market', version: '1.0.0', name: 'Market',
        description: 'A practical storefront for broad product catalogs.',
        theme: { background: '#f8faf9', foreground: '#162e33', accent: '#d34732', muted: '#dce9e8', font: 'Arial, sans-serif' },
        models, pages,
        demo: {
            brand: 'NORTH MARKET',
            hero: {
                title: 'Good things, made for daily use',
                subtitle: 'Explore new arrivals and trusted favorites.',
                image: 'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=1600&q=85',
            },
            product: {
                title: 'Classic weekender', price: '$129',
                image: 'https://images.unsplash.com/photo-1622560480654-d96214fdc887?w=1200&q=85',
                description: 'Room for everything, with a shape that carries easily.',
            },
            collection: {
                title: 'Everyday essentials', description: 'Reliable favorites for busy days and quiet weekends.',
                image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1400&q=85',
            },
            page: {
                title: 'About North Market', body: 'We bring useful, well-made goods together in one place.',
                image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1400&q=85',
            },
        },
    },
];

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

deepFreeze(presets);

export function listPresets() {
    return presets.map(({ id, version, name, description, theme, demo }) => ({
        id, version, name, description, theme, heroImage: demo.hero.image,
    }));
}

export function getPreset(id: string, version?: string): PresetManifest | null {
    return presets.find((preset) => preset.id === id && (!version || preset.version === version)) || null;
}
