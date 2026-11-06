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

test('formal runner fails closed before browsers for invalid lock and emits no passing evidence', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'b3-lock-'));
    try {
        const lock = path.join(dir, 'lock.json');
        await writeFile(lock, '{}');
        const result = spawnSync(
            process.execPath,
            ['ops/e2e/preview-roundtrip.mjs'],
            {
                encoding: 'utf8',
                env: { ...process.env, STOREFRONT_E2E_PLATFORM_LOCK: lock },
            },
        );
        assert.equal(result.status, 1);
        assert.ok(result.stdout.includes('formal-preview-blocked'));
        assert.equal(result.stdout.includes('"passed":true'), false);
        assert.equal(result.stdout.includes('AcceptanceEvidence'), false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('signal-terminated browser runner is a failed foundation', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'b3-runner-signal-'));
    try {
        await writeFile(path.join(dir, 'npx'), '#!/bin/sh\nkill -TERM $$\n', {
            mode: 0o700,
        });
        const result = spawnSync(
            process.execPath,
            ['ops/e2e/preview-roundtrip.mjs', '--foundation'],
            {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: dir + path.delimiter + process.env.PATH,
                },
            },
        );
        assert.equal(result.status, 1);
        assert.ok(result.stdout.includes('"foundationPassed":false'));
        assert.ok(result.stdout.includes('"overallB3Complete":false'));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
