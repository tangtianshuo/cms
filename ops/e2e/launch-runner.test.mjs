import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('launch missing lock is nonzero and exports all exact required IDs without claiming AcceptanceEvidence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'd1-launch-'));
    try {
        const result = spawnSync(
            process.execPath,
            ['ops/e2e/test.mjs', 'launch'],
            {
                env: {
                    ...process.env,
                    E2E_RUNTIME_DIR: directory,
                    E2E_PLATFORM_LOCK: path.join(directory, 'absent.json'),
                },
                encoding: 'utf8',
            },
        );
        assert.notEqual(result.status, 0);
        const report = JSON.parse(
            await readFile(path.join(directory, 'launch-result.json'), 'utf8'),
        );
        assert.equal(report.passed, false);
        assert.equal(report.lockChecksum, null);
        assert.equal(report.cases.length, 48);
        assert.equal(
            report.cases.find((c) => c.id === 'fireguard/CREATE').status,
            'blocked',
        );
        assert.equal(
            report.cases.find((c) => c.id === 'fireguard/CONTENT').status,
            'not-run',
        );
        assert.equal(
            report.evidenceType,
            'blocked-launch-not-AcceptanceEvidence',
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
