import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

test('unavailable browser setup preserves a failing runner exit without passing AcceptanceEvidence', () => {
    const result = spawnSync(
        process.execPath,
        ['ops/e2e/preview-roundtrip.mjs', '--foundation'],
        {
            encoding: 'utf8',
            env: {
                ...process.env,
                STOREFRONT_E2E_CMS: '',
                STOREFRONT_E2E_RESULTS_DIR: '.e2e/runner-negative',
            },
        },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout.includes('"overallB3Complete":false'), true);
    assert.equal(result.stdout.includes('"foundationPassed":false'), true);
    assert.equal(result.stdout.includes('AcceptanceEvidence'), false);
});
