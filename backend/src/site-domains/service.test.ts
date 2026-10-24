import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHostname, DomainService, type DomainSource } from './service';
import type { SiteDomain } from './model';

function memory() {
    const site = { _id: 'site', primaryDomainId: '', domainRevision: 0 };
    const records = new Map<string, SiteDomain>();
    const audit: unknown[] = [];
    let locked = false;
    let failPrimaryCommit = false;
    const source: DomainSource = {
        findSite: async () => ({ ...site }), findSiteById: async (id) => id === site._id ? { ...site } : null,
        list: async (id) => [...records.values()].filter((item) => item.siteId === id),
        findHost: async (host) => [...records.values()].find((item) => item.hostname === host) || null,
        findId: async (id) => records.get(id) || null,
        insert: async (record) => { if ([...records.values()].some((item) => item.hostname === record.hostname)) throw Object.assign(new Error('duplicate'), { code: 11000 }); records.set(record._id, structuredClone(record)); },
        replace: async (record, expected) => { if (records.get(record._id)?.updatedAt !== expected) return false; records.set(record._id, structuredClone(record)); return true; },
        remove: async (id) => { records.delete(id); },
        setPrimary: async (_site, id, event) => { if (failPrimaryCommit) throw new Error('Mandatory audit storage unavailable'); audit.push(structuredClone(event)); site.primaryDomainId = id; site.domainRevision++; },
        touch: async () => { site.domainRevision++; },
        audit: async (event) => { audit.push(event); },
        withSiteLock: async (_id, action) => { if (locked) throw new Error('Domain changed; reload'); locked = true; try { return await action(); } finally { locked = false; } },
    };
    const service = new DomainService(source, { secret: 'test-secret', entryHost: 'edge.example.com', entryIp: '', localHost: 'localhost:3000' });
    return { service, source, records, site, audit, failPrimaryAudit: () => { failPrimaryCommit = true; } };
}

test('normalizes IDNA, case and trailing dot, rejects URLs, ports, IPs and invalid labels', () => {
    assert.equal(normalizeHostname('BÜCHER.Example.'), 'xn--bcher-kva.example');
    for (const invalid of ['https://shop.test', 'a.test/path', 'a.test:443', 'user@a.test', '*.test', '127.0.0.1', '[::1]', 'localhost', '-a.test', 'a_.test', 'a..test', 'a.test\n']) assert.throws(() => normalizeHostname(invalid));
});

test('global ownership, scoped IDs, expiring credentials and new credentials after unbind', async () => {
    const { service, source, records } = memory();
    const added = await service.add('SHOP.test.', 'admin');
    assert.equal(added.domain.hostname, 'shop.test');
    assert.equal(added.domain.ownershipStatus, 'pending');
    assert.ok(added.txtValue);
    assert.equal(JSON.stringify(added.domain).includes(added.txtValue), false);
    await assert.rejects(() => service.add('shop.test', 'admin'), /bound/i);
    records.set('foreign', { ...added.domain, _id: 'foreign', siteId: 'other' } as SiteDomain);
    await assert.rejects(() => service.state('foreign', true, 'admin'), /not found/i);
    records.delete('foreign');
    await service.remove(added.domain._id, 'admin');
    const next = await service.add('shop.test', 'admin');
    assert.notEqual(next.txtValue, added.txtValue);
    const record = records.get(next.domain._id)!;
    record.verificationExpiresAt = 1;
    await assert.rejects(() => service.check(record._id, 'admin', async () => ({ ownership: true, dns: true, https: true })), /expired/i);
    assert.equal((await source.findId(record._id))?.ownershipStatus, 'pending');
});

test('checks separate ownership and connection, preserves primary on failure, prevents primary disable/delete', async () => {
    const { service, site, audit } = memory();
    const first = await service.add('one.test', 'admin');
    await service.check(first.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    await service.primary(first.domain._id, 'admin');
    assert.equal(site.primaryDomainId, first.domain._id);
    const second = await service.add('two.test', 'admin');
    await service.check(second.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: false, error: 'TLS failure' }));
    await assert.rejects(() => service.primary(second.domain._id, 'admin'), /ready/i);
    await assert.rejects(() => service.state(first.domain._id, false, 'admin'), /replacement/i);
    await assert.rejects(() => service.remove(first.domain._id, 'admin'), /replacement/i);
    assert.equal(site.primaryDomainId, first.domain._id);
    assert.equal((await service.resolve('ONE.test.'))?.primaryHostname, 'one.test');
    assert.equal(await service.resolve('two.test'), null);
    assert.equal(await service.resolve('unknown.test'), null);
    assert.ok(audit.length >= 5);
});

test('concurrent primary switches conflict; disabled aliases stop resolving immediately', async () => {
    const { service, site } = memory();
    const one = await service.add('one.test', 'admin');
    const two = await service.add('two.test', 'admin');
    for (const record of [one, two]) await service.check(record.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    const results = await Promise.allSettled([service.primary(one.domain._id, 'admin'), service.primary(two.domain._id, 'admin')]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const alias = site.primaryDomainId === one.domain._id ? two.domain : one.domain;
    assert.equal((await service.resolve(alias.hostname))?.siteId, 'site');
    await service.state(alias._id, false, 'admin');
    assert.equal(await service.resolve(alias.hostname), null);
});

test('explicit migration preserves release data and cannot claim another binding', async () => {
    const { migrateConfiguredDomain } = await import('./migration');
    const { service, site, records } = memory();
    const migrated = await migrateConfiguredDomain(service, 'existing.test', 'operator');
    assert.equal(migrated.hostname, 'existing.test');
    assert.equal(site.primaryDomainId, migrated._id);
    assert.equal((await service.resolve('existing.test'))?.siteId, 'site');
    records.set('foreign', { ...migrated, _id: 'foreign', hostname: 'foreign.test', siteId: 'other' });
    await assert.rejects(() => migrateConfiguredDomain(service, 'foreign.test', 'operator'), /ownership/i);
});

test('failed recheck keeps established domain routing and last success while returning the error', async () => {
    const { service, records } = memory();
    const added = await service.add('live.test', 'admin');
    await service.check(added.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    await service.primary(added.domain._id, 'admin');
    const record = records.get(added.domain._id)!;
    const lastSuccessAt = record.lastSuccessAt;
    record.lastCheckedAt = 1;
    const failed = await service.check(record._id, 'admin', async () => ({ ownership: false, dns: false, https: false, error: 'DNS outage' }));
    assert.equal(failed.connectionStatus, 'error');
    assert.equal(failed.lastSuccessAt, lastSuccessAt);
    assert.equal((await service.resolve('live.test'))?.hostname, 'live.test');
    await assert.rejects(() => service.check(record._id, 'admin', async () => ({ ownership: true, dns: true, https: true })), /rate limited/);
});

test('a failed mandatory primary audit leaves the established primary unchanged', async () => {
    const { service, site, failPrimaryAudit } = memory();
    const first = await service.add('first.test', 'admin');
    const replacement = await service.add('replacement.test', 'admin');
    for (const item of [first, replacement]) await service.check(item.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    await service.primary(first.domain._id, 'admin');
    const revision = site.domainRevision;
    failPrimaryAudit();
    await assert.rejects(() => service.primary(replacement.domain._id, 'admin'), /audit/i);
    assert.equal(site.primaryDomainId, first.domain._id);
    assert.equal(site.domainRevision, revision);
});

test('migration retry completes an interrupted initial promotion and preserves an established primary', async () => {
    const { migrateConfiguredDomain } = await import('./migration');
    const { service, source, site } = memory();
    const ready = await service.add('existing.test', 'operator');
    await service.check(ready.domain._id, 'operator', async () => ({ ownership: true, dns: true, https: true }));
    assert.equal(site.primaryDomainId, '');
    await migrateConfiguredDomain(service, 'existing.test', 'operator');
    assert.equal(site.primaryDomainId, ready.domain._id);
    const other = await service.add('other.test', 'operator');
    await service.check(other.domain._id, 'operator', async () => ({ ownership: true, dns: true, https: true }));
    await migrateConfiguredDomain(service, 'other.test', 'operator');
    assert.equal(site.primaryDomainId, ready.domain._id);
    assert.equal((await source.findId(other.domain._id))?.ownershipStatus, 'verified');
});

test('initial-only migration promotion preserves a primary established during its earlier reads', async () => {
    const { migrateConfiguredDomain } = await import('./migration');
    const { service, source, site } = memory();
    const first = await service.add('first.test', 'admin');
    const candidate = await service.add('candidate.test', 'admin');
    for (const item of [first, candidate]) await service.check(item.domain._id, 'admin', async () => ({ ownership: true, dns: true, https: true }));
    const find = source.findSite;
    let reads = 0;
    source.findSite = async () => {
        const snapshot = await find();
        if (reads++ === 0) site.primaryDomainId = first.domain._id;
        return snapshot;
    };
    await migrateConfiguredDomain(service, candidate.domain.hostname, 'operator');
    assert.equal(site.primaryDomainId, first.domain._id);
});
