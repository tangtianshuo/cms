import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewRuntime } from './preview-service';

const digest = `sha256:${'a'.repeat(64)}`;
const descriptor = {
    templateId: 'fireguard', templateVersion: '1.0.0', protocolVersion: 1 as const, digest,
    url: 'https://preview.example.com/preview/fireguard/1.0.0/',
};

test('resolves only an exact versioned renderer URL from the configured service origin', async () => {
    const result = await resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0', {
        fetcher: async (url) => {
            assert.equal(url, 'https://preview.example.com/api/v1/renderers/fireguard/1.0.0');
            return Response.json(descriptor);
        },
    });
    assert.deepEqual(result, descriptor);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        { fetcher: async () => Response.json({ ...descriptor, url: 'https://attacker.example/preview/fireguard/1.0.0/' }) }),
    /invalid renderer/i);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        { fetcher: async () => Response.json({ ...descriptor, templateVersion: '1.0.1' }) }), /invalid renderer/i);
});

test('treats an unregistered version as unavailable and validates the configured origin', async () => {
    assert.equal(await resolvePreviewRuntime('', 'fireguard', '1.0.0'), null);
    assert.equal(await resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        { fetcher: async () => new Response(null, { status: 404 }) }), null);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com/path', 'fireguard', '1.0.0'), /origin/i);
});

test('rejects renderer downgrade even when the origin is trusted', async () => {
    const fetcher = async () => Response.json({
        templateId: 'aeroframe', templateVersion: '1.0.3', protocolVersion: 1,
        digest, url: 'https://preview.example/preview/aeroframe/1.0.3/',
    });
    await assert.rejects(resolvePreviewRuntime('https://preview.example', 'aeroframe', '1.0.4', { fetcher }));
});

test('rejects protocol drift, malformed digests, identity drift and credential-bearing URLs', async () => {
    for (const change of [
        { protocolVersion: 2 }, { protocolVersion: undefined }, { digest: 'sha256:abc' },
        { templateId: 'aeroframe' },
        { url: 'https://user:secret@preview.example.com/preview/fireguard/1.0.0/' },
    ]) {
        await assert.rejects(resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
            { fetcher: async () => Response.json({ ...descriptor, ...change }) }), /invalid renderer/i);
    }
});

test('service errors, timeouts and redirects fail closed with safe errors', async () => {
    for (const status of [301, 302, 503]) {
        await assert.rejects(resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
            { fetcher: async () => new Response(null, { status, headers: { location: 'https://internal.invalid/secret' } }) }),
        /Preview service unavailable/);
    }
    for (const failure of [new DOMException('internal.invalid/secret', 'TimeoutError'), new Error('https://internal.invalid/secret')]) {
        await assert.rejects(resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
            {
                fetcher: async (_url, options) => {
                    assert.equal(options?.redirect, 'error');
                    assert.ok(options?.signal instanceof AbortSignal);
                    throw failure;
                },
            }), error => error instanceof Error && error.message === 'Preview service unavailable');
    }
});
