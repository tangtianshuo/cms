import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithWorkspace } from '../workspaces/context';
import { readGatewayDomainState } from './gateway';
import { createGatewayConfigResolver } from '../site-provisioning/config';
import { workspaceContext } from '../workspaces/context';
const resolveConfig = createGatewayConfigResolver({ find: async () => null, listProvisioned: async () => [] }, workspaceContext);

const config = {
    GATEWAY_BASE_URL: 'https://gateway.example.com', CMS_SERVICE_SECRET: 'shared-secret',
    GATEWAY_SITE_BINDINGS: JSON.stringify([{ cmsWorkspaceId: 'workspace-a', cmsSiteId: 'site-a', workspaceId: '11111111-1111-4111-8111-111111111111', siteId: '22222222-2222-4222-8222-222222222222', siteUrl: 'https://shop.example.com' }]),
} as NodeJS.ProcessEnv;

test('projects Gateway domain and route state for the selected CMS site', async () => {
    const fetcher = (async (url: string, init?: RequestInit) => {
        assert.equal(url, 'https://gateway.example.com/api/v1/sites/22222222-2222-4222-8222-222222222222/domains');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer shared-secret');
        return Response.json({ route: { status: 'active', revision: 4, releaseId: 'release-4', host: 'shop.example.com', health: 'healthy' }, domains: [{ id: 'd1', hostname: 'shop.example.com', ownershipStatus: 'verified', dnsStatus: 'ready', certificateStatus: 'ready', enabled: true, role: 'primary', lastCheckedAt: null, redirectTo: null }] });
    }) as typeof fetch;
    const value = await runWithWorkspace({ workspaceId: 'workspace-a', siteId: 'site-a', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => readGatewayDomainState('site-a', config, fetcher, resolveConfig));
    assert.deepEqual(value, { status: 'ready', route: { status: 'active', revision: 4, releaseId: 'release-4', host: 'shop.example.com', health: 'healthy' }, domains: [{ id: 'd1', hostname: 'shop.example.com', ownershipStatus: 'verified', dnsStatus: 'ready', certificateStatus: 'ready', enabled: true, role: 'primary', lastCheckedAt: null, redirectTo: null }] });
});

test('does not select another Gateway binding for an unbound CMS site', async () => {
    const value = await runWithWorkspace({ workspaceId: 'workspace-a', siteId: 'site-other', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => readGatewayDomainState('site-other', config, async () => { throw new Error('must not call Gateway'); }, resolveConfig));
    assert.deepEqual(value, { status: 'unconfigured' });
});
