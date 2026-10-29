import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayPublishConfig, gatewayPublishConfigs, gatewayRequest, GatewayRevisionConflict } from './gateway-client';
import { runWithWorkspace } from '../workspaces/context';

const bindingEnv = {
    GATEWAY_BASE_URL: 'https://gateway.example.com', CMS_SERVICE_SECRET: 'shared-secret',
    GATEWAY_SITE_BINDINGS: JSON.stringify([
        { cmsWorkspaceId: 'workspace-a', cmsSiteId: 'site-a', workspaceId: '11111111-1111-4111-8111-111111111111', siteId: '22222222-2222-4222-8222-222222222222', siteUrl: 'https://a.example.com' },
        { cmsWorkspaceId: 'workspace-b', cmsSiteId: 'site-b', workspaceId: '33333333-3333-4333-8333-333333333333', siteId: '44444444-4444-4444-8444-444444444444', siteUrl: 'https://b.example.com' },
    ]),
} as NodeJS.ProcessEnv;

test('Gateway config selects exactly the CMS workspace and site from verified context', () => {
    const selected = runWithWorkspace({ workspaceId: 'workspace-b', siteId: 'site-b', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig(bindingEnv));
    assert.equal(selected.siteId, '44444444-4444-4444-8444-444444444444');
    assert.equal(selected.siteUrl, 'https://b.example.com');
    assert.equal(selected.cmsWorkspaceId, 'workspace-b');
});

test('legacy binding selects only its exact CMS identity from verified context', () => {
    const legacyEnv = { GATEWAY_BASE_URL: 'https://gateway.example.com', CMS_SERVICE_SECRET: 'shared-secret',
        GATEWAY_CMS_WORKSPACE_ID: 'workspace-a', GATEWAY_CMS_SITE_ID: 'site-a',
        GATEWAY_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111', GATEWAY_SITE_ID: '22222222-2222-4222-8222-222222222222',
        GATEWAY_PUBLIC_SITE_URL: 'https://a.example.com' } as NodeJS.ProcessEnv;
    const selected = runWithWorkspace({ workspaceId: 'workspace-a', siteId: 'site-a', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig(legacyEnv));
    assert.equal(selected.siteId, '22222222-2222-4222-8222-222222222222');
    assert.equal(selected.siteUrl, 'https://a.example.com');
});

test('legacy single binding remains available to its verified workspace when site selection is deferred', () => {
    const legacyEnv = { GATEWAY_BASE_URL: 'https://gateway.example.com', CMS_SERVICE_SECRET: 'shared-secret',
        GATEWAY_CMS_WORKSPACE_ID: 'workspace-a', GATEWAY_CMS_SITE_ID: 'site-a',
        GATEWAY_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111', GATEWAY_SITE_ID: '22222222-2222-4222-8222-222222222222',
        GATEWAY_PUBLIC_SITE_URL: 'https://a.example.com' } as NodeJS.ProcessEnv;
    const matching = runWithWorkspace({ workspaceId: 'workspace-a', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig(legacyEnv));
    assert.equal(matching.siteId, '22222222-2222-4222-8222-222222222222');
    const otherWorkspace = runWithWorkspace({ workspaceId: 'workspace-b', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig(legacyEnv));
    assert.equal(otherWorkspace.siteId, '');
    assert.equal(otherWorkspace.siteUrl, '');
});

test('multiple bindings without workspace context do not select a Gateway identity', () => {
    const selected = gatewayPublishConfig(bindingEnv);
    assert.equal(selected.siteId, '');
    assert.equal(selected.workspaceId, '');
    assert.equal(selected.siteUrl, '');
});

test('a single explicit binding without verified context does not select a Gateway identity', () => {
    const single = { ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify([JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!)[0]]) };
    const selected = gatewayPublishConfig(single);
    assert.equal(selected.siteId, '');
    assert.equal(selected.workspaceId, '');
    assert.equal(selected.siteUrl, '');
});

test('unknown CMS sites are unbound without exposing another binding identity or URL', () => {
    const selected = runWithWorkspace({ workspaceId: 'workspace-c', siteId: 'site-c', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig(bindingEnv));
    assert.equal(selected.siteId, '');
    assert.equal(selected.workspaceId, '');
    assert.equal(selected.cmsSiteId, '');
    assert.equal(selected.siteUrl, '');
});

test('a verified workspace without a selected site cannot inherit a single Gateway identity', () => {
    const selected = runWithWorkspace({ workspaceId: 'workspace-a', actorId: 'admin', admin: true, instanceAdmin: false, role: 'admin' },
        () => gatewayPublishConfig({ ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify([JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!)[0]]) }));
    assert.equal(selected.siteId, '');
    assert.equal(selected.siteUrl, '');
});

test('Gateway bindings reject malformed JSON and duplicate CMS or Gateway site identities', () => {
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_BINDINGS: '{' }), /GATEWAY_SITE_BINDINGS/);
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_ID: '55555555-5555-4555-8555-555555555555' }), /cannot be combined/i);
    const duplicate = JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!);
    duplicate.push({ ...duplicate[0], siteId: '66666666-6666-4666-8666-666666666666' });
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify(duplicate) }), /duplicate/i);
    const duplicateGateway = JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!);
    duplicateGateway[1].siteId = duplicateGateway[0].siteId;
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify(duplicateGateway) }), /duplicate/i);
    const malformed = JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!);
    malformed[0].siteUrl = 17;
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify(malformed) }), /invalid gateway site binding/i);
    const credentialOverride = JSON.parse(bindingEnv.GATEWAY_SITE_BINDINGS!);
    credentialOverride[0].serviceSecret = 'attacker-secret';
    assert.throws(() => gatewayPublishConfigs({ ...bindingEnv, GATEWAY_SITE_BINDINGS: JSON.stringify(credentialOverride) }), /unexpected/i);
});

test('Gateway failures preserve a recognized error code without returning response details', async () => {
    const fetcher = (async () => Response.json({ error: 'invalid_template', message: 'token=private' }, { status: 400 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
        message: 'Gateway request failed (400): invalid_template',
    });
});

test('Gateway failures discard unknown codes and non-JSON error responses', async () => {
    for (const response of [Response.json({ error: 'token=private' }, { status: 502 }), new Response('internal password=private', { status: 502 })]) {
        const fetcher = (async () => response) as typeof fetch;
        await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
            message: 'Gateway request failed (502)',
        });
    }
});

test('Gateway registry outages retain a safe code distinct from invalid template data', async () => {
    const fetcher = (async () => Response.json({ error: 'template_registry_unavailable', details: 'token=private' }, { status: 503 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
        message: 'Gateway request failed (503): template_registry_unavailable',
    });
});

test('Gateway conflict responses retain the existing revision-conflict behavior', async () => {
    const fetcher = (async () => Response.json({ error: 'revision_conflict' }, { status: 409 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), GatewayRevisionConflict);
});
