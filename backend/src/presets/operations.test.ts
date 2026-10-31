import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSiteOperations } from './operations';

test('validates SEO, media references and analytics IDs', () => {
    const result = normalizeSiteOperations({ seoTitle: ' Store ', seoDescription: ' Description ', socialImage: { _id: 'img' }, favicon: { _id: 'fav' }, analyticsId: 'G-123', contactFormEnabled: false }, new Set(['img', 'fav']));
    assert.equal(result.seoTitle, 'Store');
    assert.equal(result.socialImage?._id, 'img');
    assert.throws(() => normalizeSiteOperations({ seoTitle: 'x'.repeat(121), contactFormEnabled: false }));
    assert.throws(() => normalizeSiteOperations({ analyticsId: 'bad id', contactFormEnabled: false }));
    assert.throws(() => normalizeSiteOperations({ socialImage: { _id: 'missing' }, contactFormEnabled: false }, new Set(['img'])));
    // The controller supplies only image media IDs; non-image assets cannot become public share metadata.
});

test('contact forms stay disabled until a delivery contract is configured', () => {
    assert.throws(() => normalizeSiteOperations({ contactFormEnabled: true }), /delivery is not configured/);
    assert.equal(normalizeSiteOperations({ contactFormEnabled: true }, undefined, { contactDeliveryConfigured: true }).contactFormEnabled, true);
});
