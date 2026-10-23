import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceContext, runWithWorkspace, workspaceContext } from './context';
const source = { workspace: async (id: string) => ({ _id: id, members: [{ userId: 'member', role: 'admin' as const }] }), site: async (id: string) => ({ _id: id, workspaceId: 'a' }) };
test('selectors require membership and site ownership; API keys are pinned', async () => {
    await assert.rejects(resolveWorkspaceContext({ userId: 'outsider', roles: ['USER'] }, { workspaceId: 'a' }, source), /access/);
    await assert.rejects(resolveWorkspaceContext({ userId: 'member', roles: ['USER'] }, { workspaceId: 'b', siteId: 'site-a' }, source), /Site/);
    await assert.rejects(resolveWorkspaceContext({ apiKeyId: 'key', workspaceId: 'a' }, { workspaceId: 'b' }, source), /API key/);
    assert.equal((await resolveWorkspaceContext({ userId: 'legacy', roles: ['USER'] }, {}, source)).workspaceId, 'default');
    assert.equal((await resolveWorkspaceContext({ userId: 'member', roles: ['USER'] }, { workspaceId: 'a' }, source)).admin, true);
});
test('verified async contexts stay isolated across interleaved requests', async () => {
    const a = await resolveWorkspaceContext({ userId: 'admin', roles: ['ADMIN'] }, { workspaceId: 'a' }, source);
    const b = await resolveWorkspaceContext({ userId: 'admin', roles: ['ADMIN'] }, { workspaceId: 'b' }, source);
    await Promise.all([a, b].map(ctx => runWithWorkspace(ctx, async () => { await new Promise(r => setTimeout(r, 5)); assert.equal(workspaceContext()?.workspaceId, ctx.workspaceId); })));
    assert.equal(workspaceContext(), undefined);
});
