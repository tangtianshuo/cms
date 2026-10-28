import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioController } from './controller';
test('every Studio read and write endpoint rejects requests without a real user token', async () => {
    const controller = await StudioController({} as never);
    const methods = await controller.methods(controller);
    assert.deepEqual(methods.map(method => method.name).sort(), ['addPage', 'entry', 'page', 'settings', 'site']);
    for (const method of methods) await assert.rejects(() => method.handler({ headers: {}, query: {}, params: {}, body: {} } as never, {} as never),
        (error: unknown) => (error as { status?: number })?.status === 403);
});
