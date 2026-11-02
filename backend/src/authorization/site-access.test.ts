import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSiteCapability, hasSiteCapability, siteCapabilities } from './site-access';
import type { WorkspaceContext } from '../workspaces/context';

const context = (role: WorkspaceContext['role']): WorkspaceContext => ({
    workspaceId: 'workspace-a',
    siteId: 'site-a',
    actorId: role,
    admin: role === 'admin',
    instanceAdmin: false,
    role,
});

test('site capabilities are explicit and role scoped', () => {
    assert.deepEqual(siteCapabilities('viewer'), ['content.read']);
    assert.equal(hasSiteCapability(context('editor'), 'content.write'), true);
    assert.equal(hasSiteCapability(context('editor'), 'pages.manage'), false);
    assert.equal(hasSiteCapability(context('viewer'), 'content.write'), false);
    assert.equal(hasSiteCapability(context('admin'), 'domains.manage'), true);
    assert.equal(hasSiteCapability(undefined, 'content.read'), false);
});

test('site capability checks fail closed for missing or insufficient scope', () => {
    assert.throws(() => assertSiteCapability(undefined, 'content.read'), (error: any) => error.status === 403);
    assert.throws(() => assertSiteCapability(context('editor'), 'publish'), /Site capability required: publish/);
    assert.doesNotThrow(() => assertSiteCapability(context('admin'), 'publish'));
});
