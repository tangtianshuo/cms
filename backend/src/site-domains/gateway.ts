import { gatewayPublishConfig, gatewayRequest, validateConfig, type GatewayPublishConfig } from '../presets/gateway-client';

export interface GatewayDomainProjection {
    status: 'ready';
    route: { status: string; revision: number; releaseId: string | null; host: string | null; health: string };
    domains: Array<{ id: string; hostname: string; ownershipStatus: string; dnsStatus: string; certificateStatus: string; enabled: boolean; role: 'primary' | 'alias'; lastCheckedAt: string | null; redirectTo: string | null }>;
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

export async function readGatewayDomainState(siteId: string, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<GatewayDomainProjection | GatewayDomainUnavailable> {
    const config = gatewayPublishConfig(env);
    if (!config.gatewayBaseUrl || !config.serviceSecret || config.cmsSiteId !== siteId) return { status: 'unconfigured' };
    const { base } = validateConfig(config);
    const value = await gatewayRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/domains`, config.serviceSecret);
    if (!valid(value)) throw new Error('Gateway returned invalid domain state');
    return { status: 'ready', route: value.route, domains: value.domains };
}
