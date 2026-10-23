import { DomainService } from './service';

// Explicit operator action for an existing, already externally provisioned host.
// No release or draft data is changed. Pending/foreign rows are never promoted.
export async function migrateConfiguredDomain(service: DomainService, hostname: string, actor: string) {
    const site = await service.site();
    const { normalizeHostname } = await import('./service');
    const host = normalizeHostname(hostname);
    const existing = await service.source.findHost(host);
    if (existing) {
        if (existing.siteId !== site._id || existing.ownershipStatus !== 'verified' || !existing.lastSuccessAt) throw new Error('Existing binding needs verification; migration cannot overwrite ownership');
        if (!site.primaryDomainId) await service.primary(existing._id, actor, { onlyIfMissing: true });
        return existing;
    }
    const added = await service.add(host, actor);
    const record = (await service.source.findId(added.domain._id))!;
    const now = Date.now();
    const migrated = { ...record, ownershipStatus: 'verified' as const, connectionStatus: 'ready' as const,
        verifiedAt: now, lastCheckedAt: now, lastSuccessAt: now, dnsReady: true, updatedAt: record.updatedAt + 1 };
    if (!await service.source.replace(migrated, record.updatedAt)) throw new Error('Domain changed; reload');
    await service.audit(site._id, record._id, actor, 'migrate-configured-host');
    if (!site.primaryDomainId) await service.primary(record._id, actor, { onlyIfMissing: true });
    return migrated;
}
