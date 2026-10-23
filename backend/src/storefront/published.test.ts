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

test('domain resolution selects site-owned release independently of caller site IDs', async () => {
    const { publishedDomainSite } = await import('./published');
    const source = { resolve: async (host: string) => host === 'alias.test' || host === 'shop.test' ? {
        siteId: 'site', hostname: host, primaryHostname: 'shop.test', bindingRevision: 3,
    } : null,
        findSiteById: async (id: string) => ({ _id: id, currentReleaseId: 'release' } as SiteInstallation),
        findRelease: async () => ({ _id: 'release', siteId: 'site', payload: JSON.stringify({ schemaVersion: 1, siteId: 'site', pages: [] }) } as ReleaseRecord),
    };
    assert.equal((await publishedDomainSite('alias.test', source))?.primaryHostname, 'shop.test');
    assert.equal(await publishedDomainSite('unknown.test', source), null);
    source.findRelease = async () => ({ _id: 'release', siteId: 'other', payload: '{}' } as ReleaseRecord);
    assert.equal(await publishedDomainSite('shop.test', source), null);
});
