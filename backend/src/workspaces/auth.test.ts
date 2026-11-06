import test from 'node:test';
import assert from 'node:assert/strict';
import { Repo } from '../repo';
import { verifyRequestWorkspace } from './auth';
import { verifiedWorkspace } from './context';
test('viewer POST remains forbidden except an explicit server-declared read-only operation', async () => {
    const original = Object.getOwnPropertyDescriptor(Repo, 'workspace')!;
    Object.defineProperty(Repo, 'workspace', { ...original, value: { methods: { fresh: async () => ({ _id: 'w', members: [{ userId: 'u', role: 'viewer' }] }) } } });
    const data = { request: { headers: { 'x-bcms-workspace': 'w' }, method: 'POST' }, errorHandler: (status: number, message: unknown) => Object.assign(new Error(String(message)), { status }) } as never;
    try {
        await assert.rejects(verifyRequestWorkspace(data, { userId: 'u', roles: ['USER'] }), /read only/);
        const result = await verifyRequestWorkspace(data, { userId: 'u', roles: ['USER'] }, {}, { readOnlyPost: true });
        assert.equal(result[verifiedWorkspace].role, 'viewer');
        const patch = { ...data as object, request: { headers: { 'x-bcms-workspace': 'w' }, method: 'PATCH' } } as never;
        await assert.rejects(verifyRequestWorkspace(patch, { userId: 'u', roles: ['USER'] }, {}, { readOnlyPost: true }), /read only/);
    } finally { Object.defineProperty(Repo, 'workspace', original); }
});
