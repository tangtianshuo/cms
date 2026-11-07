import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    requiredAcceptanceIds,
    acceptanceTemplates,
} from './acceptance-report.mjs';
import {
    createLaunchDirectory,
    validateLaunchEnvelope,
    finalizeLaunchResults,
} from './launch-results.mjs';
const run = {
    runId: 'new-run',
    lockChecksum: 'sha256:' + 'a'.repeat(64),
    scope: 'formal-UI',
};
const envelope = (target) => ({
    ...run,
    target,
    cases: requiredAcceptanceIds
        .filter((id) => id.startsWith(target.id + '/'))
        .map((id) => ({
            id,
            status: 'passed',
            reason: 'actual assertion',
            artifacts: ['proof.json'],
        })),
});
test('fresh run refuses a directory containing stale result files without modifying them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'd1-provenance-'));
    try {
        await writeFile(path.join(root, 'old.json'), 'old');
        await assert.rejects(createLaunchDirectory(root), /fresh/);
        assert.equal(
            await readFile(path.join(root, 'old.json'), 'utf8'),
            'old',
        );
        await createLaunchDirectory(path.join(root, 'new'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('rejects stale run, wrong checksum, target/version, scope and cross-target cases', () => {
    for (const patch of [
        { runId: 'old' },
        { lockChecksum: 'sha256:' + 'b'.repeat(64) },
        { target: acceptanceTemplates[1] },
        { target: { id: 'aeroframe', version: '1.0.0' } },
        { scope: 'supplementary-builtin-UI-not-exact-template-acceptance' },
        { cases: envelope(acceptanceTemplates[1]).cases },
    ])
        assert.throws(() =>
            validateLaunchEnvelope(
                { ...envelope(acceptanceTemplates[0]), ...patch },
                { ...run, target: acceptanceTemplates[0] },
            ),
        );
    assert.equal(
        validateLaunchEnvelope(envelope(acceptanceTemplates[0]), {
            ...run,
            target: acceptanceTemplates[0],
        }).length,
        24,
    );
});
test('nonzero browser or teardown after all case writes cannot export passing consumer evidence', () => {
    const cases = acceptanceTemplates.flatMap((t) => envelope(t).cases);
    for (const failure of [
        { browserExit: 1, cleanupVerified: true },
        { browserExit: 0, cleanupVerified: false },
        { browserExit: null, cleanupVerified: true },
    ]) {
        const result = finalizeLaunchResults({ ...run, cases, ...failure });
        assert.equal(result.passed, false);
        assert.equal(result.consumerEvidence, null);
        assert.ok(result.cases.every((c) => c.status !== 'passed'));
    }
    const green = finalizeLaunchResults({
        ...run,
        cases,
        browserExit: 0,
        cleanupVerified: true,
    });
    assert.equal(green.passed, true);
    assert.equal(green.consumerEvidence.cases.length, 48);
});
