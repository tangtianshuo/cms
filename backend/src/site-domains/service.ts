import { ownerWorkspace } from '../workspaces/context';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import type { SiteDomain, DomainAudit, DomainSite, DomainResolution, DomainPrimaryAudit } from './model';
export interface CheckResult { ownership: boolean; dns: boolean; https: boolean; error?: string }
export interface DomainOptions { secret: string; entryHost: string; entryIp: string; localHost: string }
export interface DomainSource {
    findSite(): Promise<DomainSite | null>;
    findSiteById(id: string): Promise<DomainSite | null>;
    list(siteId: string): Promise<SiteDomain[]>;
    findHost(host: string): Promise<SiteDomain | null>;
    findId(id: string): Promise<SiteDomain | null>;
    insert(record: SiteDomain): Promise<void>;
    replace(record: SiteDomain, expectedUpdatedAt: number): Promise<boolean>;
    remove(id: string, expectedUpdatedAt: number): Promise<void>;
    setPrimary(site: DomainSite, id: string, audit: DomainPrimaryAudit): Promise<void>;
    touch(siteId: string): Promise<void>;
    audit(event: DomainAudit): Promise<void>;
    withSiteLock<T>(siteId: string, action: () => Promise<T>): Promise<T>;
}
export function normalizeHostname(host: string): string {
    if (!host || /[\s/:@*\\?#%]/.test(host)) throw new Error('Invalid hostname');
    const ascii = domainToASCII(host.replace(/\.$/, '')).toLowerCase();
    if (ascii.length > 253 || isIP(ascii) || !ascii.includes('.') ||
        ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Invalid hostname');
    return ascii;
}
export function tokenDigest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function challengeSignature(host: string, nonce: string, secret: string): string {
    return createHmac('sha256', secret).update(`cms-domain-v1:${host}:${nonce}`).digest('hex');
}
export class DomainService {
    constructor(readonly source: DomainSource, readonly options: DomainOptions) {}
    async site() {
        const site = await this.source.findSite();
        if (!site) throw new Error('Site not installed');
        return site;
    }
    async owned(id: string, site: DomainSite) {
        const record = await this.source.findId(id);
        if (!record || (record.siteId !== site._id || ownerWorkspace(record) !== ownerWorkspace(site))) throw new Error('Domain not found');
        return record;
    }
    async audit(siteId: string, domainId: string, actorId: string, operation: string, error = '') {
        const now = Date.now();
        await this.source.audit({ _id: randomUUID(), createdAt: now, updatedAt: now, siteId, domainId, actorId, operation, error });
    }
    async list() {
        const site = await this.site();
        const items = await this.source.list(site._id);
        return { items: items.map(({ verificationTokenHash, ...record }) => ({ ...record, isPrimary: site.primaryDomainId === record._id })),
            primaryDomainId: site.primaryDomainId || '', bindingRevision: site.domainRevision || 0,
            guidance: { entryHost: this.options.entryHost, entryIp: this.options.entryIp, txtPrefix: '_cms-verify.', challengePath: '/.well-known/cms-domain-challenge' } };
    }
    async add(host: string, actor: string) {
        const site = await this.site();
        const hostname = normalizeHostname(host);
        const txtValue = `cms-verify=${randomBytes(32).toString('hex')}`;
        const now = Date.now();
        const record: SiteDomain = { _id: randomUUID(), workspaceId: ownerWorkspace(site), siteId: site._id, hostname, enabled: true,
            ownershipStatus: 'pending', connectionStatus: 'unchecked', verificationTokenHash: tokenDigest(txtValue),
            verificationExpiresAt: now + 86400000, verifiedAt: 0, lastCheckedAt: 0, lastSuccessAt: 0,
            dnsReady: false, lastError: '', createdAt: now, updatedAt: now };
        try { await this.source.insert(record); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw new Error('Domain already bound'); throw error; }
        await this.audit(site._id, record._id, actor, 'add');
        const { verificationTokenHash, ...domain } = record;
        return { domain, txtName: `_cms-verify.${hostname}`, txtValue, expiresAt: record.verificationExpiresAt };
    }
    async check(id: string, actor: string, checker: (record: SiteDomain) => Promise<CheckResult>): Promise<SiteDomain> {
        const site = await this.site();
        const record = await this.owned(id, site);
        const now = Date.now();
        if (record.ownershipStatus === 'pending' && record.verificationExpiresAt < now) throw new Error('Verification expired; remove and add the domain again');
        if (record.lastCheckedAt && now - record.lastCheckedAt < 10000) throw new Error('Check rate limited; retry in 10 seconds');
        // Reserve the attempt before network I/O, limiting concurrent requests across processes.
        const reserved = { ...record, lastCheckedAt: now, updatedAt: Math.max(now, record.updatedAt + 1) };
        if (!await this.source.replace(reserved, record.updatedAt)) throw new Error('Domain changed; reload');
        let result: CheckResult;
        try { result = await checker(record); }
        catch (error) { result = { ownership: false, dns: false, https: false, error: (error as Error).message }; }
        return this.source.withSiteLock(site._id, async () => {
            const current = await this.owned(id, site);
            if (current.updatedAt !== reserved.updatedAt) throw new Error('Domain changed; reload');
            const verified = record.ownershipStatus === 'verified' || result.ownership;
            const ready = verified && result.dns && result.https;
            const updated: SiteDomain = { ...current, ownershipStatus: verified ? 'verified' : 'pending',
                verifiedAt: record.verifiedAt || (result.ownership ? now : 0), dnsReady: result.dns,
                connectionStatus: ready ? 'ready' : 'error', lastSuccessAt: ready ? now : record.lastSuccessAt,
                lastError: ready ? '' : result.error || (!verified ? 'TXT ownership record missing or incorrect' : 'HTTPS challenge failed'), updatedAt: current.updatedAt + 1 };
            if (!await this.source.replace(updated, current.updatedAt)) throw new Error('Domain changed; reload');
            await this.source.touch(site._id);
            await this.audit(site._id, id, actor, 'check', updated.lastError);
            return updated;
        });
    }
    async primary(id: string, actor: string, options: { onlyIfMissing?: boolean } = {}): Promise<void> {
        const site = await this.site();
        await this.source.withSiteLock(site._id, async () => {
            const currentSite = await this.site();
            if (options.onlyIfMissing && currentSite.primaryDomainId) return;
            if ((site.domainRevision || 0) !== (currentSite.domainRevision || 0)) throw new Error('Domain changed; reload');
            const record = await this.owned(id, currentSite);
            if (!record.enabled || record.ownershipStatus !== 'verified' || record.connectionStatus !== 'ready') throw new Error('Domain must be enabled, verified and ready');
            // Fence stale state/delete operations against promoting this binding.
            if (!await this.source.replace({ ...record, updatedAt: Math.max(Date.now(), record.updatedAt + 1) }, record.updatedAt)) throw new Error('Domain changed; reload');
            const now = Date.now();
            await this.source.setPrimary(currentSite, id, { _id: randomUUID(), siteId: site._id, domainId: id,
                actorId: actor, operation: 'primary', outcome: 'committed', error: '', createdAt: now, updatedAt: now,
                bindingRevision: (currentSite.domainRevision || 0) + 1 });
        });
    }
    async state(id: string, enabled: boolean, actor: string): Promise<void> {
        const site = await this.site();
        await this.source.withSiteLock(site._id, async () => {
            const currentSite = await this.site();
            const record = await this.owned(id, currentSite);
            if (!enabled && currentSite.primaryDomainId === id) throw new Error('Choose a replacement primary domain first');
            if (!await this.source.replace({ ...record, enabled, updatedAt: Math.max(Date.now(), record.updatedAt + 1) }, record.updatedAt)) throw new Error('Domain changed; reload');
            await this.source.touch(site._id);
            await this.audit(site._id, id, actor, enabled ? 'enable' : 'disable');
        });
    }
    async remove(id: string, actor: string): Promise<void> {
        const site = await this.site();
        await this.source.withSiteLock(site._id, async () => {
            const currentSite = await this.site();
            const record = await this.owned(id, currentSite);
            if (currentSite.primaryDomainId === id) throw new Error('Choose a replacement primary domain first');
            await this.source.remove(id, record.updatedAt);
            await this.source.touch(site._id);
            await this.audit(site._id, id, actor, 'remove');
        });
    }
    async resolve(host: string): Promise<DomainResolution | null> {
        let hostname: string;
        try { hostname = normalizeHostname(host); } catch { return null; }
        const record = await this.source.findHost(hostname);
        if (!record?.enabled || record.ownershipStatus !== 'verified' || !record.lastSuccessAt) return null;
        const site = await this.source.findSiteById(record.siteId);
        if (!site?.primaryDomainId || ownerWorkspace(record) !== ownerWorkspace(site)) return null;
        const primary = await this.source.findId(site.primaryDomainId);
        if (!primary?.enabled || (primary.siteId !== site._id || ownerWorkspace(primary) !== ownerWorkspace(site)) || primary.ownershipStatus !== 'verified' || !primary.lastSuccessAt) return null;
        return { workspaceId: ownerWorkspace(site), siteId: site._id, hostname, primaryHostname: primary.hostname, bindingRevision: site.domainRevision || 0 };
    }
}
