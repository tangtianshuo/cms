import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSiteOperationsStatus } from '../presets/operations';
import { trustedStorefrontHost } from './trust';

test('unknown storefront hosts are rejected and custom hosts require the shared secret', () => {
    const config = { secret: 'gateway-secret', localHost: 'localhost:3000', production: true };
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'unknown.example' }, config), null);
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'unknown.example', 'x-storefront-key': 'wrong' }, config), null);
    assert.equal(trustedStorefrontHost({ 'x-storefront-host': 'SHOP.example.', 'x-storefront-key': 'gateway-secret' }, config), 'shop.example');
});

test('operations status keeps backup and release state site scoped', () => {
    const status = buildSiteOperationsStatus({
        workspaceId: 'workspace-a',
        site: { _id: 'site-a', name: 'Site A', status: 'ready', primaryDomainId: 'domain-a' },
        domains: [{ _id: 'domain-a', hostname: 'shop.example', ownershipStatus: 'verified', connectionStatus: 'ready', enabled: true }],
        gateway: { configured: true, status: 'ready', activeRevision: 8 }, storefrontEnabled: true,
        latestBackupAt: 1234, recentPublishes: [{ _id: 'release-a', createdAt: 1000, status: 'published' }], now: 2000,
    });
    assert.deepEqual(status.scope, { workspaceId: 'workspace-a', siteId: 'site-a' });
    assert.equal(status.backup.status, 'available');
    assert.equal(status.backup.restore, 'available');
    assert.equal(status.recentPublishes[0].id, 'release-a');
});
