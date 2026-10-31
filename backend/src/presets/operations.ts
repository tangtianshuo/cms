export interface MediaRef { _id: string }

export interface SiteOperations {
    seoTitle: string;
    seoDescription: string;
    socialImage?: MediaRef;
    favicon?: MediaRef;
    analyticsId?: string;
    contactFormEnabled: boolean;
}

export interface SiteOperationsStatus {
    scope: { workspaceId: string; siteId: string };
    site: { id: string; name: string; status: string };
    domain: { configured: boolean; verified: number; ready: number; primaryHostname?: string };
    https: { status: 'ready' | 'pending' | 'error' | 'unknown'; reason?: string };
    backup: { status: 'available' | 'unknown'; latestAt?: number; restore: 'available' | 'unknown' };
    storefront: { status: 'healthy' | 'unconfigured' | 'unknown'; checkedAt: number };
    gateway: { status: 'ready' | 'pending' | 'failed' | 'unconfigured' | 'unknown'; activeRevision?: number };
    recentPublishes: Array<{ id: string; createdAt: number; status: string; error?: string }>;
}

export function buildSiteOperationsStatus(input: {
    workspaceId: string;
    site: { _id: string; name: string; status: string; primaryDomainId?: string; gatewayActiveRevision?: number };
    domains: Array<{ _id: string; hostname: string; ownershipStatus: string; connectionStatus: string; enabled: boolean }>;
    gateway: { configured: boolean; status?: string; activeRevision?: number; authoritative?: boolean };
    storefrontHealth?: 'probe' | 'unknown';
    storefrontEnabled: boolean;
    recentPublishes: Array<{ _id: string; createdAt: number; status: string; error?: string }>;
    latestBackupAt?: number;
    now?: number;
}): SiteOperationsStatus {
    const verified = input.domains.filter((item) => item.ownershipStatus === 'verified').length;
    const readyDomains = input.domains.filter((item) => item.enabled && item.ownershipStatus === 'verified' && item.connectionStatus === 'ready');
    const primary = input.domains.find((item) => item._id === input.site.primaryDomainId);
    const https = readyDomains.length ? { status: 'ready' as const } : input.domains.some((item) => item.connectionStatus === 'error')
        ? { status: 'error' as const, reason: '域名接入检查失败' } : input.domains.length ? { status: 'pending' as const } : { status: 'unknown' as const };
    const gatewayStatus = input.gateway.configured ? (input.gateway.status === 'failed' ? 'failed' : input.gateway.status === 'pending' ? 'pending' : input.gateway.status === 'ready' && input.gateway.authoritative ? 'ready' : 'unknown') : 'unconfigured';
    return {
        scope: { workspaceId: input.workspaceId, siteId: input.site._id },
        site: { id: input.site._id, name: input.site.name, status: input.site.status },
        domain: { configured: input.domains.length > 0, verified, ready: readyDomains.length, ...(primary ? { primaryHostname: primary.hostname } : {}) },
        https,
        backup: { status: input.latestBackupAt ? 'available' : 'unknown', ...(input.latestBackupAt ? { latestAt: input.latestBackupAt } : {}), restore: input.latestBackupAt ? 'available' : 'unknown' },
        storefront: { status: !input.storefrontEnabled ? 'unconfigured' : input.storefrontHealth === 'probe' ? 'healthy' : 'unknown', checkedAt: input.now || Date.now() },
        gateway: { status: gatewayStatus, ...(input.gateway.activeRevision ? { activeRevision: input.gateway.activeRevision } : {}) },
        recentPublishes: input.recentPublishes.map((item) => ({ id: item._id, createdAt: item.createdAt, status: item.status, ...(item.error ? { error: item.error } : {}) })),
    };
}

export function normalizeSiteOperations(input: Partial<SiteOperations> | undefined, mediaIds?: Set<string>, options: { contactDeliveryConfigured?: boolean } = {}): SiteOperations {
    const value = input || {};
    const seoTitle = typeof value.seoTitle === 'string' ? value.seoTitle.trim() : '';
    const seoDescription = typeof value.seoDescription === 'string' ? value.seoDescription.trim() : '';
    if (seoTitle.length > 120 || seoDescription.length > 320) throw new Error('SEO title or description is too long');
    const media = (candidate: unknown, label: string): MediaRef | undefined => {
        if (candidate === undefined) return undefined;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || typeof (candidate as MediaRef)._id !== 'string' || !(candidate as MediaRef)._id.trim()) {
            throw new Error(`Invalid ${label} media reference`);
        }
        const ref = { _id: (candidate as MediaRef)._id.trim() };
        if (mediaIds && !mediaIds.has(ref._id)) throw new Error(`${label} media is not available`);
        return ref;
    };
    const analyticsId = value.analyticsId === undefined || value.analyticsId === '' ? undefined : String(value.analyticsId).trim();
    if (analyticsId && !/^[A-Za-z0-9_-]{1,100}$/.test(analyticsId)) throw new Error('Invalid analytics ID');
    const requestedContact = value.contactFormEnabled === true;
    if (requestedContact && !options.contactDeliveryConfigured) throw new Error('Contact form delivery is not configured');
    return { seoTitle, seoDescription, socialImage: media(value.socialImage, 'Social image'), favicon: media(value.favicon, 'Favicon'),
        ...(analyticsId ? { analyticsId } : {}), contactFormEnabled: requestedContact };
}
