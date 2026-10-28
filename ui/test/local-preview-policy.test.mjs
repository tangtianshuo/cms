import assert from 'node:assert/strict';
import test from 'node:test';

const origin = process.env.STOREFRONT_E2E_CMS;

test('Docker management policy permits its local storefront iframe', { skip: !origin }, async () => {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const policy = response.headers.get('content-security-policy');
    assert.ok(policy, 'management response must retain CSP');
    const directives = new Map(policy.split(';').filter((part) => part.trim()).map((part) => {
        const [name, ...sources] = part.trim().split(/\s+/);
        return [name, sources];
    }));
    const sources = directives.get('frame-src') || directives.get('default-src');
    const expectedOrigins = (process.env.STOREFRONT_E2E_PREVIEW_ORIGINS || 'http://localhost:3000').split(',');
    for (const expected of expectedOrigins) {
        assert.equal(new URL(expected).origin, expected, 'expected preview must be an exact origin');
        assert.ok(sources.includes(expected), `preview origin must be allowed: ${expected}`);
    }
    assert.ok(sources.includes("'self'"), 'same-origin frames must remain allowed');
    assert.ok(!sources.some((source) => ['*', 'http:', 'https:'].includes(source)),
        'preview must not allow arbitrary remote frames');
    assert.ok(directives.get('frame-ancestors')?.includes("'self'"), 'retain embedding protection');
});
