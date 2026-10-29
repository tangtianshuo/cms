import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayRequest, GatewayRevisionConflict } from './gateway-client';

test('Gateway failures preserve a recognized error code without returning response details', async () => {
    const fetcher = (async () => Response.json({ error: 'invalid_template', message: 'token=private' }, { status: 400 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
        message: 'Gateway request failed (400): invalid_template',
    });
});

test('Gateway failures discard unknown codes and non-JSON error responses', async () => {
    for (const response of [Response.json({ error: 'token=private' }, { status: 502 }), new Response('internal password=private', { status: 502 })]) {
        const fetcher = (async () => response) as typeof fetch;
        await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
            message: 'Gateway request failed (502)',
        });
    }
});

test('Gateway registry outages retain a safe code distinct from invalid template data', async () => {
    const fetcher = (async () => Response.json({ error: 'template_registry_unavailable', details: 'token=private' }, { status: 503 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), {
        message: 'Gateway request failed (503): template_registry_unavailable',
    });
});

test('Gateway conflict responses retain the existing revision-conflict behavior', async () => {
    const fetcher = (async () => Response.json({ error: 'revision_conflict' }, { status: 409 })) as typeof fetch;
    await assert.rejects(gatewayRequest(fetcher, 'https://gateway.invalid', 'fixture-secret'), GatewayRevisionConflict);
});
