import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedStorefrontHost } from './trust';

test('custom host context requires shared gateway secret; production fails closed without config', () => {
    const config = { secret: 'a-secret', localHost: 'localhost:3000', production: true };
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'shop.test', 'x-forwarded-host': 'shop.test' }, config), null);
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'SHOP.test.', 'x-storefront-key': 'a-secret' }, config), 'shop.test');
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'shop.test', 'x-storefront-key': 'wrong' }, config), null);
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'localhost:3000' }, { ...config, secret: '', production: true }), null);
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'localhost:3000' }, { ...config, secret: '', production: false }), 'localhost:3000');
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'attacker.test' }, { ...config, secret: '', production: false }), null);
});
