import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewRuntime } from './preview-service';

const digest = `sha256:${'a'.repeat(64)}`;
const descriptor = {
    templateId: 'fireguard', templateVersion: '1.0.0', protocolVersion: 1 as const, digest,
    url: 'https://preview.example.com/preview/fireguard/1.0.0/',
};

test('resolves only an exact versioned renderer URL from the configured service origin', async () => {
    const result = await resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0', async (url) => {
        assert.equal(url, 'https://preview.example.com/api/v1/renderers/fireguard/1.0.0');
        return Response.json(descriptor);
    });
    assert.deepEqual(result, descriptor);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        async () => Response.json({ ...descriptor, url: 'https://attacker.example/preview/fireguard/1.0.0/' })), /invalid renderer/i);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        async () => Response.json({ ...descriptor, templateVersion: '1.0.1' })), /invalid renderer/i);
});

test('treats an unregistered version as unavailable and validates the configured origin', async () => {
    assert.equal(await resolvePreviewRuntime('', 'fireguard', '1.0.0'), null);
    assert.equal(await resolvePreviewRuntime('https://preview.example.com', 'fireguard', '1.0.0',
        async () => new Response(null, { status: 404 })), null);
    await assert.rejects(() => resolvePreviewRuntime('https://preview.example.com/path', 'fireguard', '1.0.0'), /origin/i);
});
