import test from 'node:test';
import assert from 'node:assert/strict';

test('interaction timeline rejects caller text and excludes URL, headers, bodies and console canaries', async () => {
    const { interactionTrace } = await import('./interaction-trace.mjs');
    const { EventEmitter } = await import('node:events');
    const page = new EventEmitter();
    const trace = interactionTrace(page);
    assert.throws(() => trace.step('password-canary'), /Unknown trace step/);
    trace.step('editor-open');
    const secret = 'TOKEN_COOKIE_QUERY_DOM_CONSOLE_CANARY';
    const request = {
        method: () => 'POST',
        url: () =>
            `https://account:${secret}@cms.invalid/api/v4/studio/preview?token=${secret}`,
        headers: () => ({ authorization: secret, cookie: secret }),
        postData: () => secret,
    };
    page.emit('request', request);
    page.emit('response', { request: () => request, status: () => 200 });
    page.emit('console', { type: () => 'error', text: () => secret });
    page.emit('pageerror', new Error(secret));
    page.emit('framenavigated', { url: () => `https://cms.invalid/${secret}` });
    const result = trace.finish();
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.traceType, 'credential-safe-interaction-timeline');
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.deepEqual(
        result.events.map((event) => event.kind),
        ['step', 'request', 'response', 'console', 'pageerror', 'navigation'],
    );
    assert.equal(result.events[1].route, 'preview');
    assert.equal(result.events[2].status, 200);
    assert.ok(result.events.every((event) => Number.isFinite(event.elapsedMs)));
    assert.equal(page.listenerCount('request'), 0);
});
