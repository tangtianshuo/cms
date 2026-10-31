export interface ProductPage {
    site: { name: string; language: string; currency: string };
    config: {
        schemaVersion: 1;
        pageType: 'product-detail';
        sections: Array<
            | { type: 'product-gallery'; source: 'product.images' }
            | { type: 'product-information'; fields: Array<'name' | 'price' | 'description'>; specifications?: Array<{ label: string; value: string }>; relatedProducts?: string[]; cta?: { label: string; href: string } }
            | { type: 'product-description'; source: 'product.description' }
            | { type: 'faq'; items: Array<{ question: string; answer: string }> }
        >;
    };
    product: {
        slug: string;
        name: string;
        price: number;
        description: string;
        images: Array<{ src: string; alt: string }>;
        specifications?: Array<{ label: string; value: string }>;
        relatedProducts?: Array<{ slug: string; name: string; image?: string }>;
    };
}
