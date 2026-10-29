import assert from 'node:assert/strict';
import test from 'node:test';
import { runGatewayRecoveryTick, withGatewayRecoveryWorkspace } from './gateway-jobs';
import { gatewayPublishConfigs, type GatewayPublishConfig } from './gateway-client';
import { workspaceContext } from '../workspaces/context';

const config = (cmsWorkspaceId: string, cmsSiteId: string): GatewayPublishConfig => ({
    gatewayBaseUrl: 'https://gateway.example.com', workspaceId: '11111111-1111-4111-8111-111111111111',
    siteId: '22222222-2222-4222-8222-222222222222', serviceSecret: 'shared-secret',
    cmsWorkspaceId, cmsSiteId, siteUrl: 'https://shop.example.com',
});

test('recovery tick catches configuration parsing failures instead of rejecting', async () => {
    const errors: unknown[] = [];
    await assert.doesNotReject(runGatewayRecoveryTick(() => gatewayPublishConfigs({ GATEWAY_SITE_BINDINGS: '{' }), async () => undefined,
        cause => errors.push(cause)));
    assert.equal(errors.length, 1);
});

test('recovery tick continues after one binding fails and runs each binding in its CMS context', async () => {
    const bindings = [config('workspace-a', 'site-a'), config('workspace-b', 'site-b'), config('workspace-c', 'site-c')];
    const visited: string[] = [];
    const errors: unknown[] = [];
    await runGatewayRecoveryTick(() => bindings, binding => withGatewayRecoveryWorkspace(binding, async () => {
        const context = workspaceContext();
        assert.equal(context?.workspaceId, binding.cmsWorkspaceId);
        assert.equal(context?.siteId, binding.cmsSiteId);
        visited.push(binding.cmsSiteId);
        if (binding.cmsSiteId === 'site-b') throw new Error('recover failed');
    }), cause => errors.push(cause));
    assert.deepEqual(visited, ['site-a', 'site-b', 'site-c']);
    assert.equal(errors.length, 1);
});
