import assert from 'node:assert/strict';
import test from 'node:test';
import type { Media } from '../media/models/main';
import type { ReleaseSnapshot } from '../presets/releases';
import { MediaStorage } from '../media/storage';
import { collectReleaseAssets } from './assets';
import { rewriteContractMediaUrls } from './snapshot';

test('collectReleaseAssets creates a deterministic checksum manifest for referenced media', async context => {
    context.mock.method(MediaStorage, 'read', async (media: Media) => Buffer.from(media._id));
    const snapshot = { schemaVersion: 1 as const, siteId: 'site', language: 'en', mediaIds: ['b', 'a'], pages: [], navigation: [], redirects: [] };
    const media = [
        { _id: 'b', type: 'IMG', mimetype: 'image/png' },
        { _id: 'a', type: 'IMG', mimetype: 'image/jpeg' },
        { _id: 'folder', type: 'DIR', mimetype: 'directory' },
    ] as unknown as Media[];
    const assets = await collectReleaseAssets(snapshot, media);
    assert.deepEqual(assets.map(asset => asset.path), ['media/a/original.jpeg', 'media/b/original.png']);
    assert.equal(assets[0].checksum, 'sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    assert.equal(assets[0].mediaId, 'a');
    assert.equal(assets[0].contentBase64, Buffer.from('a').toString('base64'));
    const rewritten = rewriteContractMediaUrls({ ...snapshot, pages: [{ path: '/', pageKey: 'home', entryId: 'entry', content: { image: 'https://cms.test/api/v4/media/a/bin/image?cap=preview' } }] } as unknown as ReleaseSnapshot, assets);
    assert.equal((rewritten.pages[0].content as unknown as { image: string }).image, '/_assets/media/a/original.jpeg');
});

test('collectReleaseAssets fails closed when a referenced file is unavailable', async context => {
    context.mock.method(MediaStorage, 'read', async () => null);
    await assert.rejects(() => collectReleaseAssets({ schemaVersion: 1, siteId: 'site', language: 'en', mediaIds: ['missing'], pages: [], navigation: [], redirects: [] },
        [{ _id: 'missing', type: 'IMG', mimetype: 'image/png' } as unknown as Media]), /unavailable/i);
});
