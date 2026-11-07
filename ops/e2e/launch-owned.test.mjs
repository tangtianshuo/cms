import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { verifyArtifactBinding, verifyServedPreview } from './launch-owned.mjs';
const digest = (bytes) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex');
test('fixture-scope archive identity rejects wrong lock, source and modified bytes', () => {
    const archive = Buffer.from('explicit unit fixture, not a formal artifact');
    const pinned = {
        id: 'aeroframe',
        version: '1.0.4',
        manifestChecksum: digest('manifest'),
        previewArtifactDigest: digest(archive),
        previewBundleDigest: digest('bundle'),
    };
    const record = {
        id: pinned.id,
        version: pinned.version,
        sourceCommit: 'a'.repeat(40),
        manifestChecksum: pinned.manifestChecksum,
        bundleDigest: pinned.previewBundleDigest,
        artifactDigest: pinned.previewArtifactDigest,
    };
    verifyArtifactBinding(record, pinned, 'a'.repeat(40), archive);
    for (const change of [
        { sourceCommit: 'b'.repeat(40) },
        { version: '1.0.3' },
        { bundleDigest: digest('other') },
    ])
        assert.throws(() =>
            verifyArtifactBinding(
                { ...record, ...change },
                pinned,
                'a'.repeat(40),
                archive,
            ),
        );
    assert.throws(() =>
        verifyArtifactBinding(
            record,
            pinned,
            'a'.repeat(40),
            Buffer.from('modified'),
        ),
    );
});
test('fixture-scope live Preview comparison rejects correct descriptor with wrong served bytes', async () => {
    const bytes = Buffer.from('<main>owned unit fixture</main>');
    let wrong = false,
        origin;
    const record = {
        id: 'aeroframe',
        version: '1.0.4',
        bundleDigest: digest('bundle'),
    };
    const server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/')) {
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    digest: record.bundleDigest,
                    url: origin + '/preview/aeroframe/1.0.4/',
                }),
            );
        } else res.end(wrong ? Buffer.from('other renderer') : bytes);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = 'http://127.0.0.1:' + server.address().port;
    const manifest = {
        files: [
            {
                path: 'index.html',
                size: bytes.length,
                checksum: digest(bytes).slice(7),
            },
        ],
    };
    try {
        await verifyServedPreview(origin, record, manifest);
        wrong = true;
        await assert.rejects(verifyServedPreview(origin, record, manifest));
    } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
    }
});

import { runOwnedFixture } from './owned-runtime.mjs';
test('formal lifecycle cannot enter local direct-pin path without concrete drivers', async () => {
    await assert.rejects(runOwnedFixture({ formal: true }), /concrete/);
});
