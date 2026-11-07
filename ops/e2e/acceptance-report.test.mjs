import test from 'node:test';
import assert from 'node:assert/strict';
import {
    requiredAcceptanceIds,
    summarizeAcceptance,
    acceptanceEvidence,
} from './acceptance-report.mjs';
const checksum = 'sha256:' + 'a'.repeat(64);
const results = () =>
    requiredAcceptanceIds.map((id) => ({
        id,
        status: 'passed',
        reason: '',
        artifacts: ['run/proof.json'],
    }));
test('blocked domain cannot pass and missing required cells remain not-run', () => {
    const result = summarizeAcceptance([
        { id: 'aeroframe/CREATE', status: 'passed', reason: '', artifacts: [] },
        {
            id: 'aeroframe/DOMAINS',
            status: 'blocked',
            reason: 'TLS not ready',
            artifacts: [],
        },
    ]);
    assert.equal(result.passed, false);
    assert.ok(result.blocked.includes('aeroframe/DOMAINS'));
    assert.ok(result.notRun.includes('fireguard/CREATE'));
});
test('exports precisely 24 required cases for each of the two templates', () => {
    assert.equal(requiredAcceptanceIds.length, 48);
    assert.equal(new Set(requiredAcceptanceIds).size, 48);
    assert.ok(requiredAcceptanceIds.includes('fireguard/ANALYTICS'));
    assert.ok(requiredAcceptanceIds.includes('aeroframe/EDIT_CONFLICT'));
});
test('duplicate and unknown cases fail closed', () => {
    assert.throws(
        () => summarizeAcceptance([...results(), results()[0]]),
        /Duplicate/,
    );
    assert.throws(
        () => summarizeAcceptance([{ ...results()[0], id: 'aeroframe/BOGUS' }]),
        /Unknown/,
    );
});
test('unknown status and malformed evidence fail closed', () => {
    for (const change of [
        { status: 'skipped' },
        { artifacts: 'proof' },
        { reason: null },
    ])
        assert.throws(
            () => summarizeAcceptance([{ ...results()[0], ...change }]),
            /Invalid/,
        );
});
test('only all mandatory results pass the case summary', () => {
    assert.equal(summarizeAcceptance(results()).passed, true);
    for (const status of ['failed', 'blocked', 'not-run']) {
        const cases = results();
        cases[1].status = status;
        assert.equal(summarizeAcceptance(cases).passed, false);
    }
});
test('passing cases without a lock checksum cannot produce formal evidence', () => {
    for (const lockChecksum of [undefined, null, '', 'sha256:local'])
        assert.throws(
            () => acceptanceEvidence({ cases: results(), lockChecksum }),
            /lock checksum/,
        );
});
test('formal evidence contains missing cases and validates artifact presence and environment', () => {
    const document = acceptanceEvidence({
        cases: results().slice(1),
        lockChecksum: checksum,
        environment: 'isolated',
    });
    assert.equal(document.cases.length, 48);
    assert.equal(document.cases[0].status, 'not-run');
    assert.throws(
        () =>
            acceptanceEvidence({
                cases: [{ ...results()[0], artifacts: [] }],
                lockChecksum: checksum,
                environment: 'isolated',
            }),
        /artifact/,
    );
    assert.throws(
        () =>
            acceptanceEvidence({
                cases: results(),
                lockChecksum: checksum,
                environment: 'local',
            }),
        /environment/,
    );
});
