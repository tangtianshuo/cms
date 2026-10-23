import assert from 'node:assert/strict';
import test from 'node:test';
import { PresetController } from './controller';

test('public catalog lists selectable presets without CMS credentials', async () => {
    const controller = await PresetController({} as never);
    const methods = await controller.methods(controller);
    const catalog = methods.find((method) => method.name === 'catalog');
    assert.ok(catalog);
    const result = await catalog.handler({ headers: {}, query: {} } as never, { header() { return undefined; } } as never);
    assert.equal((JSON.parse(result as string) as { items: unknown[] }).items.length, 2);
});

test('site import and preflight require an admin token', async () => {
    const controller = await PresetController({} as never);
    const methods = await controller.methods(controller);
    for (const name of ['plan', 'site', 'import']) {
        const method = methods.find((item) => item.name === name);
        assert.ok(method);
        await assert.rejects(
            () => method.handler({ headers: {}, query: {}, params: { presetId: 'atelier' }, body: {} } as never, {} as never),
            (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
        );
    }
});
