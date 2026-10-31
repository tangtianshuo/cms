import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSiteOperationsStatus } from './operations';

test('operations status is scoped to the selected site and reports domain, gateway and backup state', () => {
    const result = buildSiteOperationsStatus({
        workspaceId: 'workspace-a',
        site: { _id: 'site-a', name: '店铺 A', status: 'ready', primaryDomainId: 'domain-a', gatewayActiveRevision: 4 },
        domains: [{ _id: 'domain-a', hostname: 'shop.example.com', ownershipStatus: 'verified', connectionStatus: 'ready', enabled: true }],
        gateway: { configured: true, status: 'ready', activeRevision: 4, authoritative: true }, storefrontEnabled: true, storefrontHealth: 'probe', latestBackupAt: 123,
        recentPublishes: [{ _id: 'release-a', createdAt: 100, status: 'published' }], now: 200,
    });
    assert.deepEqual(result.scope, { workspaceId: 'workspace-a', siteId: 'site-a' });
    assert.equal(result.https.status, 'ready');
    assert.equal(result.gateway.activeRevision, 4);
    assert.equal(result.backup.latestAt, 123);
    assert.equal(result.recentPublishes[0].id, 'release-a');
});

test('unknown infrastructure remains unknown instead of being reported healthy', () => {
    const result = buildSiteOperationsStatus({ workspaceId: 'w', site: { _id: 's', name: 'S', status: 'ready' }, domains: [], gateway: { configured: true, status: 'ready' }, storefrontEnabled: true, recentPublishes: [] });
    assert.equal(result.https.status, 'unknown');
    assert.equal(result.gateway.status, 'unknown');
    assert.equal(result.storefront.status, 'unknown');
    assert.equal(result.backup.status, 'unknown');
});
