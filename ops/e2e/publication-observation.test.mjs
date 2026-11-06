import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const expected = {
    releaseId: 'release-1',
    activeRevision: 7,
    templateId: 'aeroframe',
    templateVersion: '1.0.4',
    workspaceId: 'selected-workspace',
    siteId: 'selected-site',
    siteUrl: 'https://shop.example.com/',
    marker: 'HOME-PUBLISHED-MARKER',
};
const markerChecksum =
    'sha256:' + createHash('sha256').update(expected.marker).digest('hex');
const ready = {
    schemaVersion: 1,
    status: 'ready',
    cmsWorkspaceId: expected.workspaceId,
    cmsSiteId: expected.siteId,
    siteUrl: expected.siteUrl,
    releaseId: 'release-1',
    activeRevision: 7,
    template: { id: 'aeroframe', version: '1.0.4' },
    snapshotChecksum: 'sha256:' + 'a'.repeat(64),
    publishedHome: {
        projection: 'home-hero-title',
        markerChecksum,
        contentChecksum: 'sha256:' + 'b'.repeat(64),
        containsMarker: true,
    },
};

test('publication verification requires exact authoritative release/revision/site/template and immutable rendered-home marker', async () => {
    const loaded = await import('./publication-observation.mjs').catch(
        () => ({}),
    );
    assert.equal(
        typeof loaded.verifyPublicationObservation,
        'function',
        'Read-only observation verifier required',
    );
    const verify = loaded.verifyPublicationObservation;
    assert.equal(verify(ready, expected).releaseId, 'release-1');
    for (const change of [
        (value) => {
            value.status = 'blocked';
        },
        (value) => {
            value.status = 'unavailable';
        },
        (value) => {
            value.releaseId = 'other';
        },
        (value) => {
            value.activeRevision = 8;
        },
        (value) => {
            value.cmsSiteId = 'other';
        },
        (value) => {
            value.cmsWorkspaceId = 'other';
        },
        (value) => {
            value.template.version = '1.0.1';
        },
        (value) => {
            value.template.id = 'fireguard';
        },
        (value) => {
            value.siteUrl = 'https://other.example.com';
        },
        (value) => {
            value.publishedHome.containsMarker = false;
        },
        (value) => {
            value.publishedHome.markerChecksum = 'sha256:' + 'c'.repeat(64);
        },
        (value) => {
            value.publishedHome.projection = 'whole-record-json';
        },
        (value) => {
            delete value.snapshotChecksum;
        },
    ]) {
        const value = structuredClone(ready);
        change(value);
        assert.throws(() => verify(value, expected));
    }
    for (const key of ['imageDigest', 'manifestChecksum', 'sourceCommit']) {
        assert.throws(() =>
            verify(ready, { ...expected, [key]: 'wrong-locked-identity' }),
        );
    }
    for (const activeRevision of [undefined, 0, -1, 7.5, '7'])
        assert.throws(() => verify(ready, { ...expected, activeRevision }));
});

test('formal requester makes one observation GET and blocks before public fetch on incomplete authority', async () => {
    const { readAndVerifyPublication } = await import(
        './publication-observation.mjs'
    );
    const requests = [];
    const send = async (request) => {
        requests.push(request);
        return ready;
    };
    await readAndVerifyPublication(send, expected);
    assert.deepEqual(requests, [
        {
            method: 'GET',
            url: '/api/v4/presets/releases/gateway/observation?marker=HOME-PUBLISHED-MARKER',
        },
    ]);
    let publicReads = 0;
    await assert.rejects(async () => {
        await readAndVerifyPublication(async (request) => {
            requests.push(request);
            return {
                schemaVersion: 1,
                status: 'blocked',
                reason: 'publication_incomplete',
            };
        }, expected);
        publicReads++;
    });
    assert.equal(publicReads, 0);
    const before = requests.length;
    await assert.rejects(() =>
        readAndVerifyPublication(send, {
            ...expected,
            activeRevision: undefined,
        }),
    );
    assert.equal(requests.length, before);
});

test('setup guard allows observational reads and fails acceptance for recovery reads or publication writes', async () => {
    const { installPublicationReadGuard } = await import(
        './publication-observation.mjs'
    );
    for (const [method, pathname, blocked] of [
        ['GET', '/api/v4/presets/releases/gateway/observation?marker=x', false],
        ['GET', '/api/v4/presets/releases/gateway', true],
        ['GET', '/api/v4/presets/releases/', true],
        ['POST', '/api/v4/presets/releases/publish', true],
        ['DELETE', '/api/v4/presets/releases/release-1', true],
        ['PUT', '/api/v4/presets/releases/gateway/observation', true],
    ]) {
        let handler,
            continued = 0,
            aborted = 0;
        const assertSafe = await installPublicationReadGuard({
            route: async (pattern, callback) => {
                assert.equal(pattern, '**/api/v4/presets/releases/**');
                handler = callback;
            },
        });
        await handler({
            request: () => ({
                method: () => method,
                url: () => 'https://cms.example.com' + pathname,
            }),
            continue: async () => continued++,
            abort: async () => aborted++,
        });
        assert.equal(continued, blocked ? 0 : 1);
        assert.equal(aborted, blocked ? 1 : 0);
        if (blocked) assert.throws(assertSafe, /setup attempted/);
        else assertSafe();
    }
});
