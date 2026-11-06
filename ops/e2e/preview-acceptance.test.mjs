import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

test('formal preview gate rejects absent, duplicate, stale and nonpassed template/viewport cells', async () => {
    const { requiredPreviewCells, summarizePreview } = await import(
        './preview-acceptance.mjs'
    );
    const lock = {
        schemaVersion: 1,
        contractVersion: 1,
        repositories: Object.fromEntries(
            ['cms', 'gateway', 'templates', 'preview'].map((key) => [
                key,
                { repository: key, commit: 'a'.repeat(40) },
            ]),
        ),
        templates: [
            ['aeroframe', '1.0.4'],
            ['fireguard', '1.0.1'],
        ].map(([id, version]) => ({
            id,
            version,
            ...Object.fromEntries(
                [
                    'manifestChecksum',
                    'imageDigest',
                    'previewArtifactDigest',
                    'previewBundleDigest',
                ].map((key) => [key, 'sha256:' + 'b'.repeat(64)]),
            ),
        })),
    };
    const bytes = Buffer.from(JSON.stringify(lock));
    const checksum =
        'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const cells = requiredPreviewCells(lock).map((cell) => ({
        ...cell,
        status: 'passed',
        reason: '',
        artifacts: ['proof.json'],
        lockChecksum: checksum,
    }));
    const valid = () =>
        summarizePreview({ lockBytes: bytes, cells, environment: 'isolated' });
    assert.equal(valid().passed, true);
    assert.throws(
        () =>
            summarizePreview({
                lockBytes: bytes,
                cells: [
                    { ...cells[0], dimensions: { width: 390, height: 900 } },
                    ...cells.slice(1),
                ],
                environment: 'isolated',
            }),
        /dimension/,
    );
    assert.equal(
        summarizePreview({
            lockBytes: bytes,
            cells: cells.slice(1),
            environment: 'isolated',
        }).passed,
        false,
    );
    for (const status of ['blocked', 'not-run', 'failed'])
        assert.equal(
            summarizePreview({
                lockBytes: bytes,
                cells: [{ ...cells[0], status }, ...cells.slice(1)],
                environment: 'isolated',
            }).passed,
            false,
        );
    assert.throws(
        () =>
            summarizePreview({
                lockBytes: bytes,
                cells: [...cells, cells[0]],
                environment: 'isolated',
            }),
        /duplicate/,
    );
    assert.throws(
        () =>
            summarizePreview({
                lockBytes: bytes,
                cells: [
                    { ...cells[0], lockChecksum: 'sha256:' + 'c'.repeat(64) },
                    ...cells.slice(1),
                ],
                environment: 'isolated',
            }),
        /checksum/,
    );
    assert.throws(
        () =>
            summarizePreview({
                lockBytes: bytes,
                cells: [{ ...cells[0], version: '0.0.0' }, ...cells.slice(1)],
                environment: 'isolated',
            }),
        /identity/,
    );
    assert.throws(
        () =>
            summarizePreview({
                lockBytes: Buffer.from('{}'),
                cells,
                environment: 'isolated',
            }),
        /PlatformLock/,
    );
    assert.throws(
        () =>
            summarizePreview({ lockBytes: bytes, cells, environment: 'local' }),
        /environment/,
    );
    assert.ok(
        valid().evidence.cases.some(
            (item) => item.id === 'aeroframe/PREVIEW_MOBILE',
        ),
    );
});
