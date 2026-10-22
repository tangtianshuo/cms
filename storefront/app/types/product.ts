export interface ProductPage {
    site: { name: string; language: string; currency: string };
    config: {
        schemaVersion: 1;
        pageType: 'product-detail';
        sections: Array<
            | { type: 'product-gallery'; source: 'product.images' }
            | { type: 'product-information'; fields: Array<'name' | 'price' | 'description'> }
            | { type: 'product-description'; source: 'product.description' }
        >;
    };
    product: {
        slug: string;
        name: string;
        price: number;
        description: string;
        images: Array<{ src: string; alt: string }>;
    };
}
