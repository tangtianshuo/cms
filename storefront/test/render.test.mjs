import assert from 'node:assert/strict';
import test from 'node:test';
import { productSeo } from '../utils/seo.mjs';

test('product SEO includes canonical URL and escaped structured data', () => {
    const seo = productSeo({
        site: { name: 'Example Store', currency: 'USD', language: 'en' },
        product: {
            slug: 'studio-headphones',
            name: '<Studio> Headphones',
            description: 'Daily listening.',
            price: 129,
            images: [{ src: 'https://media.example.test/headphones.jpg', alt: 'Headphones' }],
        },
    }, 'https://shop.example.test');
    assert.equal(seo.title, '<Studio> Headphones | Example Store');
    assert.equal(seo.canonical, 'https://shop.example.test/products/studio-headphones');
    assert.equal(seo.structuredData.includes('<Studio>'), false);
    assert.equal(JSON.parse(seo.structuredData).offers.priceCurrency, 'USD');
});
