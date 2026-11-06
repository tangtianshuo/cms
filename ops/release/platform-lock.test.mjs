import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePlatformLock } from './platform-lock.mjs';
const fixture = () => ({
    schemaVersion: 1,
    contractVersion: 1,
    repositories: Object.fromEntries(
        ['cms', 'gateway', 'templates', 'preview'].map((repository) => [
            repository,
            { repository: `owner/${repository}`, commit: '1'.repeat(40) },
        ]),
    ),
    templates: [
        {
            id: 'aeroframe',
            version: '1.0.4',
            manifestChecksum: `sha256:${'1'.repeat(64)}`,
            imageDigest: `sha256:${'2'.repeat(64)}`,
            previewArtifactDigest: `sha256:${'3'.repeat(64)}`,
            previewBundleDigest: `sha256:${'4'.repeat(64)}`,
        },
    ],
});
test('requires all four exact source identities', () => {
    assert.throws(() =>
        validatePlatformLock({
            schemaVersion: 1,
            contractVersion: 1,
            repositories: {},
            templates: [],
        }),
    );
    for (const key of ['cms', 'gateway', 'templates', 'preview']) {
        const value = fixture();
        delete value.repositories[key];
        assert.throws(() => validatePlatformLock(value));
    }
});
test('rejects missing repository and malformed commit identities', () => {
    for (const commit of [
        '',
        'a'.repeat(39),
        'a'.repeat(41),
        'G'.repeat(40),
        'A'.repeat(40),
    ]) {
        const value = fixture();
        value.repositories.cms.commit = commit;
        assert.throws(() => validatePlatformLock(value));
    }
    const value = fixture();
    value.repositories.preview.repository = ' ';
    assert.throws(() => validatePlatformLock(value));
});
test('requires all four sha256 template digests', () => {
    for (const key of [
        'manifestChecksum',
        'imageDigest',
        'previewArtifactDigest',
        'previewBundleDigest',
    ]) {
        for (const digest of [
            undefined,
            '',
            '1'.repeat(64),
            `sha256:${'a'.repeat(63)}`,
            `sha256:${'A'.repeat(64)}`,
        ]) {
            const value = fixture();
            value.templates[0][key] = digest;
            assert.throws(() => validatePlatformLock(value));
        }
    }
});
test('rejects empty, duplicate and malformed template identities', () => {
    const empty = fixture();
    empty.templates = [];
    assert.throws(() => validatePlatformLock(empty));
    const duplicate = fixture();
    duplicate.templates.push({ ...duplicate.templates[0] });
    assert.throws(() => validatePlatformLock(duplicate));
    for (const version of ['', 'latest', '1.2', '01.0.0', '../1.0.0']) {
        const value = fixture();
        value.templates[0].version = version;
        assert.throws(() => validatePlatformLock(value));
    }
    for (const id of ['', '../a', 'AeroFrame']) {
        const value = fixture();
        value.templates[0].id = id;
        assert.throws(() => validatePlatformLock(value));
    }
});
test('rejects incompatible schemas and accepts a complete valid object', () => {
    assert.deepEqual(validatePlatformLock(fixture()), fixture());
    for (const value of [
        null,
        [],
        {},
        { ...fixture(), schemaVersion: 2 },
        { ...fixture(), contractVersion: 2 },
    ])
        assert.throws(() => validatePlatformLock(value));
});
test('CLI rejects source-only evidence and accepts only complete lock format', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'platform-lock-'));
    try {
        const file = path.join(dir, 'lock.json');
        await writeFile(file, JSON.stringify({ ...fixture(), templates: [] }));
        const run = () =>
            spawnSync(
                process.execPath,
                [
                    new URL('./platform-lock.mjs', import.meta.url).pathname,
                    'verify',
                    file,
                ],
                { encoding: 'utf8' },
            );
        assert.notEqual(run().status, 0);
        await writeFile(file, JSON.stringify(fixture()));
        assert.equal(run().status, 0);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
