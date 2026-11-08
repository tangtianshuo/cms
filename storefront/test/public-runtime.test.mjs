import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { loadPublicSite } from '../server/utils/public-runtime.mjs';

async function artifact() {
    const root = await mkdtemp(join(tmpdir(), 'cms-public-runtime-'));
    await mkdir(join(root, 'assets'), { recursive: true });
    const snapshot = {
        origin: 'https://shop.test',
        primaryHostname: 'shop.test',
        bindingRevision: 1,
        language: 'en',
        pages: [
            { path: '/', pageKey: 'home', content: { kind: 'preset-page' } },
        ],
        navigation: [],
        redirects: [],
        paths: ['/'],
    };
    const checksum = `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
    await writeFile(
        join(root, 'release.json'),
        JSON.stringify({
            releaseId: 'release-1',
            siteHost: 'shop.test',
            templateId: 'aeroframe',
            templateVersion: '1.0.3',
            rendererDigest: 'sha256:renderer',
            snapshot,
            snapshotChecksum: checksum,
        }),
    );
    return { root };
}

test('loads a public page from an artifact without a fetcher', async () => {
    const { root } = await artifact();
    try {
        const page = await loadPublicSite({
            artifactRoot: root,
            releaseId: 'release-1',
            host: 'shop.test',
            path: '/',
        });
        assert.equal(page.releaseId, 'release-1');
        assert.equal(page.path, '/');
        assert.equal(typeof page.content, 'object');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('refuses public CMS reads unless the compatibility flag is explicit', async () => {
    await assert.rejects(
        () =>
            loadPublicSite({
                host: 'shop.test',
                path: '/',
                cmsOrigin: 'http://cms.test',
                fetcher: async () => ({}),
            }),
        (error) => error.code === 'runtime_unconfigured',
    );
});

test('allows the legacy CMS source only when explicitly enabled', async () => {
    const result = await loadPublicSite({
        legacyCmsPublicRead: true,
        host: 'shop.test',
        expectedHost: 'shop.test',
        cmsOrigin: 'http://cms.test',
        path: '/',
        fetcher: async (url) => {
            assert.equal(
                url,
                'http://cms.test/api/v4/storefront/published?path=%2F',
            );
            return { releaseId: 'legacy' };
        },
    });
    assert.equal(result.releaseId, 'legacy');
});

test('an artifact site fails closed instead of falling back to the legacy CMS source', async () => {
    let called = false;
    await assert.rejects(
        () =>
            loadPublicSite({
                runtimeMode: 'artifact',
                legacyCmsPublicRead: true,
                host: 'shop.test',
                path: '/',
                cmsOrigin: 'http://cms.test',
                fetcher: async () => {
                    called = true;
                    return { releaseId: 'legacy' };
                },
            }),
        (error) => error.code === 'runtime_unconfigured',
    );
    assert.equal(called, false);
});

test('a legacy site requires its site-level compatibility adapter', async () => {
    await assert.rejects(
        () =>
            loadPublicSite({
                runtimeMode: 'legacy',
                host: 'shop.test',
                path: '/',
            }),
        (error) => error.code === 'legacy_runtime_disabled',
    );
});

test('explicit legacy mode ignores a configured artifact root and reads legacy CMS', async () => {
    const { root } = await artifact();
    let called = 0;
    try {
        const result = await loadPublicSite({
            runtimeMode: 'legacy',
            artifactRoot: root,
            releaseId: 'release-1',
            legacyCmsPublicRead: true,
            host: 'shop.test',
            expectedHost: 'shop.test',
            cmsOrigin: 'http://cms.test',
            path: '/',
            fetcher: async () => {
                called += 1;
                return { releaseId: 'legacy' };
            },
        });
        assert.equal(result.releaseId, 'legacy');
        assert.equal(called, 1);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('rejects an unknown site runtime mode instead of selecting a fallback', async () => {
    await assert.rejects(
        () =>
            loadPublicSite({
                runtimeMode: 'automatic',
                artifactRoot: '/tmp/artifact',
                host: 'shop.test',
                path: '/',
            }),
        (error) => error.code === 'runtime_mode_invalid',
    );
});
