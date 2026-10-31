import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioController, assertStudioPageEntryBinding } from './controller';
test('every Studio read and write endpoint rejects requests without a real user token', async () => {
    const controller = await StudioController({} as never);
    const methods = await controller.methods(controller);
    assert.deepEqual(methods.map(method => method.name).sort(), ['addPage', 'entry', 'page', 'settings', 'site']);
    for (const method of methods) await assert.rejects(() => method.handler({ headers: {}, query: {}, params: {}, body: {} } as never, {} as never),
        (error: unknown) => (error as { status?: number })?.status === 403);
});

test('Studio page updates require an Entry bound to the selected site', () => {
    assert.doesNotThrow(() => assertStudioPageEntryBinding('site-a', 'entry-a', { _id: 'entry-a', siteId: 'site-a' }));
    assert.throws(() => assertStudioPageEntryBinding('site-a', 'entry-a', null), /binding/);
    assert.throws(() => assertStudioPageEntryBinding('site-a', 'entry-a', { _id: 'entry-a' }), /binding/);
    assert.throws(() => assertStudioPageEntryBinding('site-a', 'entry-a', { _id: 'entry-a', siteId: 'site-b' }), /binding/);
    assert.throws(() => assertStudioPageEntryBinding('site-a', 'entry-a', { _id: 'entry-b', siteId: 'site-a' }), /binding/);
});
