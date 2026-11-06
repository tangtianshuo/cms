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

test('dynamic domain mutations use only the selected persisted source binding and never fall back on outage', async () => {
    const { gatewayDomainMutation } = await import('./gateway');
    const selected = { gatewayBaseUrl: 'https://gateway.example.com', serviceSecret: 'secret', cmsWorkspaceId: 'workspace-a', cmsSiteId: 'site-a', workspaceId: '11111111-1111-4111-8111-111111111111', siteId: '22222222-2222-4222-8222-222222222222', siteUrl: 'https://default.example.com', sourceHeaders: { 'X-CMS-Workspace': 'workspace-a', 'X-CMS-Site': 'site-a' } };
    let calls = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
        calls++;
        assert.equal(url, 'https://gateway.example.com/api/v1/sites/22222222-2222-4222-8222-222222222222/domains/domain-id/primary');
        assert.equal(new Headers(init.headers).get('X-CMS-Site'), 'site-a');
        return Response.json({ status: 'pending' }, { status: 202 });
    }) as typeof fetch;
    assert.deepEqual(await gatewayDomainMutation('site-a', 'domain-id', 'primary', undefined, {}, fetcher, async () => selected), { status: 'pending' });
    await assert.rejects(gatewayDomainMutation('other', 'domain-id', 'primary', undefined, {}, fetcher, async () => selected), /mismatch/);
    assert.equal(await gatewayDomainMutation('site-a', 'domain-id', 'primary', undefined, {}, fetcher, async () => ({ ...selected, sourceHeaders: undefined })), null);
    assert.equal(calls, 1);
    await assert.rejects(gatewayDomainMutation('site-a', '', 'add', {hostname:'custom.example'}, {}, async () => { throw Error('unavailable'); }, async () => selected));
});
