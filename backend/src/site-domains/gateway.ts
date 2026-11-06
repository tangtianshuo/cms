import { resolveGatewayPublishConfig } from '../site-provisioning/config';
import { gatewayManagementRequest, validateConfig } from '../presets/gateway-client';

export interface GatewayDomainProjection {
    status: 'ready';
    route: { status: string; revision: number; releaseId: string | null; host: string | null; health: string };
    operation?: {id: string; status: string; error: string | null; operation: string; domainId: string} | null;
    guidance?: {entryHost: string; entryIp: string; txtPrefix: string; challengePath: string};
    domains: Array<{ platformOwned?: boolean; lastError?: string | null; id: string; hostname: string; ownershipStatus: string; dnsStatus: string; certificateStatus: string; enabled: boolean; role: 'primary' | 'alias'; lastCheckedAt: string | null; redirectTo: string | null }>;
}

export interface GatewayDomainUnavailable { status: 'unconfigured' }

function valid(value: unknown): value is Omit<GatewayDomainProjection, 'status'> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const body = value as Record<string, unknown>;
    const route = body.route as Record<string, unknown> | null;
    const domains = body.domains;
    return !!route && typeof route.status === 'string' && typeof route.revision === 'number' && Number.isSafeInteger(route.revision) && route.revision >= 0 &&
        (route.releaseId === null || typeof route.releaseId === 'string') && (route.host === null || typeof route.host === 'string') &&
        typeof route.health === 'string' && Array.isArray(domains) && domains.every(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
            const domain = item as Record<string, unknown>;
            return typeof domain.id === 'string' && typeof domain.hostname === 'string' && typeof domain.ownershipStatus === 'string' &&
                typeof domain.dnsStatus === 'string' && typeof domain.certificateStatus === 'string' && typeof domain.enabled === 'boolean' &&
                (domain.role === 'primary' || domain.role === 'alias') && (domain.lastCheckedAt === null || typeof domain.lastCheckedAt === 'string') &&
                (domain.redirectTo === null || typeof domain.redirectTo === 'string');
        });
}

export async function readGatewayDomainState(siteId: string, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, resolveConfig = resolveGatewayPublishConfig): Promise<GatewayDomainProjection | GatewayDomainUnavailable> {
    const config = await resolveConfig(env);
    if (!config.gatewayBaseUrl || !config.serviceSecret || config.cmsSiteId !== siteId) return { status: 'unconfigured' };
    const { base } = validateConfig(config);
    const value = await gatewayManagementRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/domains`, config);
    if (!valid(value)) throw new Error('Gateway returned invalid domain state');
    return { ...value, status: 'ready', route: value.route, domains: value.domains };
}

/** Returns null only for deliberately legacy-only sites. Errors never fall back. */
export async function gatewayDomainMutation(siteId: string, domainId: string, operation: 'add' | 'check' | 'primary' | 'state' | 'remove', body?: unknown,
    env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, resolveConfig = resolveGatewayPublishConfig): Promise<unknown | null> {
    const config = await resolveConfig(env);
    if (!config.sourceHeaders) return null;
    if (config.cmsSiteId !== siteId) throw new Error('Gateway site binding mismatch');
    const { base } = validateConfig(config);
    const suffix = operation === 'add' ? '' : `/${encodeURIComponent(domainId)}/${operation}`;
    return gatewayManagementRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/domains${suffix}`, config, { method: 'POST', body: JSON.stringify(body || {}) });
}

export async function readDynamicDomainList(siteId: string) {
    const config = await resolveGatewayPublishConfig();
    if (!config.sourceHeaders) return null;
    const gateway = await readGatewayDomainState(siteId);
    if (gateway.status !== 'ready') throw new Error('Gateway domain state unavailable');
    return {
        items: gateway.domains.map(domain => {
            const ready = domain.ownershipStatus === 'verified' && domain.dnsStatus === 'ready' && domain.certificateStatus === 'ready';
            const checked = domain.lastCheckedAt ? Date.parse(domain.lastCheckedAt) : 0;
            return { _id: domain.id, siteId, hostname: domain.hostname, enabled: domain.enabled, isPrimary: domain.role === 'primary',
                platformOwned: domain.platformOwned, ownershipStatus: domain.ownershipStatus, connectionStatus: ready ? 'ready' : checked ? 'error' : 'unchecked',
                certificateStatus: domain.certificateStatus, dnsReady: domain.dnsStatus === 'ready', lastCheckedAt: checked, lastSuccessAt: ready ? checked : 0,
                lastError: domain.lastError || '', createdAt: 0, updatedAt: checked, verifiedAt: 0, verificationExpiresAt: 0 };
        }),
        primaryDomainId: gateway.domains.find(domain => domain.role === 'primary')?.id || '', bindingRevision: gateway.route.revision,
        guidance: gateway.guidance || { entryHost: '', entryIp: '', txtPrefix: '_cms-verify.', challengePath: '/.well-known/cms-domain-challenge' }, gateway,
    };
}
