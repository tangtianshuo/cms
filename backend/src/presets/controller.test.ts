import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PresetController } from './controller';
import { getPreset } from './catalog';
import { canonicalJson } from './registry';

test('public catalog lists selectable presets without CMS credentials', async () => {
    const originalFetch = globalThis.fetch;
    const sourceCommit = 'a'.repeat(40);
    const preset = getPreset('aeroframe', '1.0.0')!;
    const manifest = { schemaVersion: 1, id: 'aeroframe', version: '1.0.1', name: preset.name,
        description: preset.description, compatibility: { cmsSchema: 1, releaseSchema: 1 },
        presentation: { theme: preset.theme, demo: preset.demo, showcase: preset.showcase },
        models: preset.models, pages: preset.pages, assets: [] };
    const checksum = `sha256:${createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(manifest)))).digest('hex')}`;
    const record = { schemaVersion: 1, id: 'aeroframe', version: '1.0.1', manifestChecksum: checksum,
        imageRepository: 'ghcr.io/tangtianshuo/independent-website-templates/aeroframe',
        imageDigest: `sha256:${'b'.repeat(64)}`, sourceCommit, manifestPath: 'templates/aeroframe/1.0.1/template.json', status: 'available' };
    globalThis.fetch = (async (url: string | URL | Request) => String(url).includes('/commits/registry')
        ? Response.json({ sha: sourceCommit })
        : String(url).endsWith('/registry/index.json')
            ? Response.json({ schemaVersion: 1, records: [record] })
            : Response.json(manifest)) as typeof fetch;
    try {
    const controller = await PresetController({} as never);
    const methods = await controller.methods(controller);
    const catalog = methods.find((method) => method.name === 'catalog');
    assert.ok(catalog);
    const result = await catalog.handler({ headers: {}, query: {} } as never, { header() { return undefined; } } as never);
    const body = JSON.parse(result as string) as { items: unknown[]; publicRegistryAvailable: boolean };
    assert.equal(body.items.length, 4);
    assert.equal(body.publicRegistryAvailable, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('public catalog keeps builtin presets available when GitHub is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ message: 'unavailable' }, { status: 503 })) as typeof fetch;
    try {
        const controller = await PresetController({} as never);
        const methods = await controller.methods(controller);
        const catalog = methods.find((method) => method.name === 'catalog');
        assert.ok(catalog);
        const result = JSON.parse(await catalog.handler({ headers: {}, query: {} } as never, { header() { return undefined; } } as never) as string) as {
            items: unknown[]; publicRegistryAvailable: boolean; registryError: string;
        };
        assert.equal(result.items.length, 3);
        assert.equal(result.publicRegistryAvailable, false);
        assert.ok(result.registryError);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('site import and preflight require an admin token', async () => {
    const controller = await PresetController({} as never);
    const methods = await controller.methods(controller);
    for (const name of ['plan', 'site', 'import', 'pages', 'addPage']) {
        const method = methods.find((item) => item.name === name);
        assert.ok(method);
        await assert.rejects(
            () => method.handler({ headers: {}, query: {}, params: { presetId: 'atelier' }, body: {} } as never, {} as never),
            (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
        );
    }
});

test('preview context requires a user token', async () => {
    const controller = await PresetController({} as never);
    const methods = await controller.methods(controller);
    const method = methods.find((item) => item.name === 'previewContext');
    assert.ok(method);
    await assert.rejects(
        () => method.handler({ headers: {}, query: {}, params: { templateId: 'template' } } as never, {} as never),
        (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
    );
});
