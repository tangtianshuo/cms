import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRuntimeHeaders } from '../app/utils/public-runtime.mjs';

test('forwards only the trusted storefront request headers to the SSR API call', () => {
    assert.deepEqual(publicRuntimeHeaders({
        host: 'builtin.localhost',
        'x-storefront-host': 'builtin.localhost',
        'x-storefront-key': 'runtime-secret',
        authorization: 'should-not-forward',
    }), {
        host: 'builtin.localhost',
        'x-storefront-host': 'builtin.localhost',
        'x-storefront-key': 'runtime-secret',
    });
});
