import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeclaredSectionProperties, normalizeSectionConfigs, validateSectionConfigs, validateSectionMediaReferences, type SectionConfig } from './section-schema';

test('accepts an ordered hero carousel and preserves required home sections', () => {
    const sections: SectionConfig[] = [
        { type: 'hero-carousel', enabled: true, data: { slides: [
            { image: { _id: 'media-1' }, title: 'One', order: 0, cta: { href: '/collections' } },
            { image: { _id: 'media-2' }, title: 'Two', order: 1 },
        ] } },
        { type: 'info-grid', enabled: true, data: { items: [{ title: 'Fast', text: 'Ready' }] } },
    ];
    assert.doesNotThrow(() => validateSectionConfigs('home', sections, { publishedPaths: new Set(['/collections']) }));
    assert.deepEqual(normalizeSectionConfigs('home', sections).map(item => item.type), ['hero-carousel', 'info-grid']);
});

test('rejects invalid internal links and duplicate carousel order', () => {
    assert.throws(() => validateSectionConfigs('home', [{
        type: 'hero-carousel', enabled: true, data: { slides: [
            { image: { _id: 'media-1' }, order: 0, cta: { href: '/missing' } },
            { image: { _id: 'media-2' }, order: 0 },
        ] },
    }], { publishedPaths: new Set(['/']) }), /internal link|order/);
});

test('product details require gallery and information while allowing faq and related products', () => {
    const sections: SectionConfig[] = [
        { type: 'product-gallery', enabled: true, data: { images: [{ _id: 'media-1' }] } },
        { type: 'product-information', enabled: true, data: { specifications: [{ label: 'Weight', value: '2kg' }], relatedProducts: ['p-2'] } },
        { type: 'product-description', enabled: true, data: { body: 'Details' } },
        { type: 'faq', enabled: true, data: { items: [{ question: 'Q', answer: 'A' }] } },
    ];
    assert.doesNotThrow(() => validateSectionConfigs('product-detail', sections));
});

test('section media must exist and be authorized for the selected site', () => {
    const sections: SectionConfig[] = [{ type: 'hero-carousel', enabled: true, data: {
        slides: [{ image: { _id: 'site-image' }, title: 'One', order: 0 }],
    } }];
    const site = { _id: 'site-a', workspaceId: 'workspace-a' } as never;
    const media = [{ _id: 'site-image', workspaceId: 'workspace-a', siteId: 'site-a', mimetype: 'image/png' },
        { _id: 'foreign-image', workspaceId: 'workspace-a', siteId: 'site-b', mimetype: 'image/png' }] as never;
    assert.doesNotThrow(() => validateSectionMediaReferences('home', sections, { media, site }));
    assert.throws(() => validateSectionMediaReferences('home', [{ ...sections[0], data: { slides: [{ image: { _id: 'foreign-image' }, title: 'One', order: 0 }] } }], { media, site }), /not available/i);
    assert.throws(() => validateSectionMediaReferences('home', [{ ...sections[0], data: { slides: [{ image: { _id: 'missing' }, title: 'One', order: 0 }] } }], { media, site }), /not available/i);
    assert.throws(() => validateSectionMediaReferences('home', sections, { media: [{ _id: 'site-image', workspaceId: 'workspace-a', mimetype: 'image/png' }] as never, site }), /not available/i);
});

test('carousel rejects executable and protocol-relative links', () => {
    for (const href of ['javascript:alert(1)', '//untrusted.invalid', 'data:text/html,test']) {
        assert.throws(() => validateSectionConfigs('home', [{ type: 'hero-carousel', enabled: true, data: { slides: [{ image: { _id: 'image' }, order: 0, cta: { href } }] } }]), /link/);
    }
});

test('declared properties validate finite scalars, required visible values and media ownership', () => {
    const sections = [{ type: 'hero', label: '首页', allowedPages: ['home'], singleton: true, required: true, props: {
        title: { control: 'text', required: true }, count: { control: 'number' }, showButton: { control: 'boolean' },
        href: { control: 'text', required: true, visibleWhen: { field: 'showButton', equals: true } },
        image: { control: 'media' }, date: { control: 'date' }, tone: { control: 'enum', options: ['light'] }, body: { control: 'rich-text' },
    } }] as any;
    const site = { _id: 'site-a', workspaceId: 'workspace-a' } as never;
    const media = [{ _id: 'own', siteId: 'site-a', workspaceId: 'workspace-a', mimetype: 'image/png' }, { _id: 'foreign', siteId: 'site-b', workspaceId: 'workspace-a', mimetype: 'image/png' }] as never;
    const valid = { title: '标题', count: 0, showButton: false, image: { _id: 'own' }, body: { content: [{ text: '结构化保留' }] } };
    const validate = (props: Record<string, unknown>) => validateDeclaredSectionProperties([{ type: 'hero', enabled: true, data: props }], sections, { media, site });
    assert.doesNotThrow(() => validate(valid));
    for (const count of [-1, 1.5]) assert.doesNotThrow(() => validate({ ...valid, count }));
    for (const patch of [{ title: ' ' }, { count: Infinity }, { count: '1' }, { showButton: true }, { date: '2026-02-30' }, { tone: 'bad' }, { image: { _id: 'foreign' } }, { image: { _id: 'unknown' } }, { image: { _id: 'own', extra: true } }]) assert.throws(() => validate({ ...valid, ...patch }), /内容|数字|日期|选项|图片|title|count|href|image/);
    assert.deepEqual(valid.body, { content: [{ text: '结构化保留' }] });
});


test('required readonly section collections reject empty values and preserve nonempty values', () => {
    for (const control of ['array', 'widget']) {
        const declared = { content: { control, required: true } } as any;
        for (const value of [undefined, [], {}]) assert.throws(() => validateDeclaredSectionProperties([{ type: 'hero', enabled: true, data: { content: value } }], [{ type: 'hero', props: declared }] as any, { site: { _id: 'site' } as any, media: [] }), /content/);
        assert.doesNotThrow(() => validateDeclaredSectionProperties([{ type: 'hero', enabled: true, data: { content: { preserved: 'content' } } }], [{ type: 'hero', props: declared }] as any, { site: { _id: 'site' } as any, media: [] }));
    }
});
