export interface PresetDemo {
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
    demo: {
        brand: string;
        hero: { title: string; subtitle: string; image: string };
        product: { title: string; price: string; image: string; description: string };
        collection: { title: string; description: string; image: string };
        page: { title: string; body: string; image: string };
    };
}

export interface PresetPagePreview {
    kind: 'preset-page';
    view: 'home' | 'collection' | 'product' | 'page';
    preset: PresetDemo;
    sections: string[];
    seo: { title: string; description: string };
    items?: Array<{ label: string; path: string; image: string; description: string; price: string }>;
}

export interface PublishedPageResponse {
    origin: string;
    primaryHostname: string;
    bindingRevision: number;
    releaseId: string;
    language: string;
    path: string;
    content?: PresetPagePreview;
    redirect?: string;
    navigation: Array<{ label: string; path: string }>;
}
