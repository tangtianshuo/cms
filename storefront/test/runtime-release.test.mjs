import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readRuntimeAsset, readRuntimeRelease, RuntimeReleaseError } from '../server/utils/runtime-release.mjs';

function checksum(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'cms-runtime-release-'));
    const assets = join(root, 'assets');
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, 'logo.txt'), 'published asset');
    const snapshot = {
        origin: 'https://shop.test',
        primaryHostname: 'shop.test',
        language: 'en',
        pages: [{ path: '/', pageKey: 'home', content: { kind: 'preset-page' } }],
        paths: ['/'],
    };
    await writeFile(join(root, 'release.json'), JSON.stringify({
        releaseId: 'release-1',
        siteHost: 'shop.test',
        templateId: 'aeroframe',
        templateVersion: '1.0.3',
        rendererDigest: 'sha256:renderer',
        snapshot,
        snapshotChecksum: checksum(snapshot),
        assetRoot: 'assets',
    }));
    return { root, snapshot };
}

test('reads a self-contained release only for the expected site and release', async () => {
    const { root, snapshot } = await fixture();
    try {
        const release = await readRuntimeRelease({ artifactRoot: root, siteHost: 'shop.test', releaseId: 'release-1' });
        assert.equal(release.releaseId, 'release-1');
        assert.equal(release.templateId, 'aeroframe');
        assert.deepEqual(release.snapshot, snapshot);
        await assert.rejects(
            () => readRuntimeRelease({ artifactRoot: root, siteHost: 'other.test', releaseId: 'release-1' }),
            (error) => error instanceof RuntimeReleaseError && error.code === 'site_mismatch',
        );
        await assert.rejects(
            () => readRuntimeRelease({ artifactRoot: root, siteHost: 'shop.test', releaseId: 'release-2' }),
            (error) => error instanceof RuntimeReleaseError && error.code === 'release_mismatch',
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('rejects a release whose snapshot checksum does not match', async () => {
    const { root } = await fixture();
    try {
        const manifestPath = join(root, 'release.json');
        const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
        manifest.snapshot.pages[0].path = '/tampered';
        await writeFile(manifestPath, JSON.stringify(manifest));
        await assert.rejects(
            () => readRuntimeRelease({ artifactRoot: root, siteHost: 'shop.test', releaseId: 'release-1' }),
            (error) => error instanceof RuntimeReleaseError && error.code === 'snapshot_checksum_mismatch',
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('reads published assets and rejects traversal or missing files', async () => {
    const { root } = await fixture();
    try {
        const release = await readRuntimeRelease({ artifactRoot: root, siteHost: 'shop.test', releaseId: 'release-1' });
        assert.equal((await readRuntimeAsset(release, '/_assets/logo.txt')).toString(), 'published asset');
        await assert.rejects(
            () => readRuntimeAsset(release, '/_assets/../release.json'),
            (error) => error instanceof RuntimeReleaseError && error.code === 'asset_path_invalid',
        );
        await assert.rejects(
            () => readRuntimeAsset(release, '/_assets/missing.txt'),
            (error) => error instanceof RuntimeReleaseError && error.code === 'asset_missing',
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
