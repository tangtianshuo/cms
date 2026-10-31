import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSectionConfigs, validateSectionConfigs, validateSectionMediaReferences, type SectionConfig } from './section-schema';

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
