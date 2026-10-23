import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseController } from './release-controller';

test('release validation, history, publishing and rollback require an administrator', async () => {
    const controller = await ReleaseController({} as never);
    const methods = await controller.methods(controller);
    for (const name of ['history', 'check', 'publish', 'rollback']) {
        const method = methods.find((item) => item.name === name);
        assert.ok(method);
        await assert.rejects(() => method.handler({ headers: {}, query: {}, body: {} } as never, {} as never),
            (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403));
    }
});
