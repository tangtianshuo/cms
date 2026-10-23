import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteInstallation } from '../presets/site-model';
import type { ReleaseRecord, ReleaseSnapshot } from '../presets/releases';
import { publishedSite } from './published';

test('public lookup reads only the site-owned active snapshot and enforces host identity', async () => {
    let reads = 0;
    const site = { _id: 'site', currentReleaseId: 'release' } as SiteInstallation;
    const snapshot: ReleaseSnapshot = { schemaVersion: 1, siteId: 'site', language: 'en',
        pages: [], navigation: [], redirects: [] };
    const source = { findSite: async () => site, findRelease: async () => {
        reads++;
        return { _id: 'release', siteId: 'site', payload: JSON.stringify(snapshot) } as ReleaseRecord;
    } };
    assert.equal(await publishedSite('other.test', 'shop.test', source), null);
    assert.equal(reads, 0);
    assert.equal((await publishedSite('shop.test', 'shop.test', source))?.releaseId, 'release');
    site.currentReleaseId = undefined;
    assert.equal(await publishedSite('shop.test', 'shop.test', source), null);
    site.currentReleaseId = 'release';
    snapshot.siteId = 'another-site';
    assert.equal(await publishedSite('shop.test', 'shop.test', source), null);
});
