import assert from 'node:assert/strict';
import test from 'node:test';
import { createMcpApi } from './api';

test('MCP API forwards authentication and workspace selectors for DELETE', async () => {
    let captured: any;
    const api = createMcpApi(
        {
            async inject(options: any) {
                captured = options;
                return { statusCode: 200, json: () => ({ ok: true }) };
            },
        } as never,
        'Bearer jwt',
        {
            'x-bcms-workspace': 'workspace-a',
            'x-bcms-site': 'site-a',
        },
    );

    assert.deepEqual(await api('DELETE', '/api/v4/resource/123'), { ok: true });
    assert.equal(captured.method, 'DELETE');
    assert.equal(captured.url, '/api/v4/resource/123');
    assert.deepEqual(captured.headers, {
        authorization: 'Bearer jwt',
        'x-bcms-workspace': 'workspace-a',
        'x-bcms-site': 'site-a',
    });
});

test('MCP API returns the backend message for failed requests', async () => {
    const api = createMcpApi(
        {
            async inject() {
                return {
                    statusCode: 409,
                    json: () => ({ message: 'Domain changed; reload' }),
                };
            },
        } as never,
        'Bearer jwt',
        {},
    );

    await assert.rejects(api('POST', '/api/v4/site-domains/x/primary'), {
        message: 'Domain changed; reload',
    });
});

test('MCP API encodes binary controller responses as base64', async () => {
    const api = createMcpApi(
        {
            async inject() {
                return {
                    statusCode: 200,
                    headers: { 'content-type': 'image/png' },
                    rawPayload: Buffer.from('image-bytes'),
                    json() {
                        throw new Error('not json');
                    },
                };
            },
        } as never,
        'Bearer jwt',
        {},
    );

    assert.deepEqual(await api('GET', '/api/v4/media/x/bin/x.png'), {
        contentType: 'image/png',
        base64: Buffer.from('image-bytes').toString('base64'),
    });
});
