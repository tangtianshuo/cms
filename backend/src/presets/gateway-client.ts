import { workspaceContext } from '../workspaces/context';

export interface GatewayPublishConfig {
    gatewayBaseUrl: string;
    workspaceId: string;
    siteId: string;
    serviceSecret: string;
    cmsWorkspaceId: string;
    cmsSiteId: string;
    siteUrl: string;
}

export interface GatewaySiteBinding {
    cmsWorkspaceId: string;
    cmsSiteId: string;
    workspaceId: string;
    siteId: string;
    siteUrl: string;
}

export class GatewayRevisionConflict extends Error {}

const publicFailureCodes = new Set([
    'invalid_template', 'template_not_found', 'invalid_release', 'template_pin_mismatch',
    'release_conflict', 'request_too_large', 'site_not_found', 'release_not_found',
    'template_pin_unavailable', 'release_unavailable', 'invalid_request', 'publish_pending',
    'publication_state_unavailable',
    'template_registry_unavailable',
]);

function sharedConfig(env: NodeJS.ProcessEnv) {
    return { gatewayBaseUrl: env.GATEWAY_BASE_URL || '', serviceSecret: env.CMS_SERVICE_SECRET || '' };
}

export function gatewayPublishConfigs(env: NodeJS.ProcessEnv = process.env): GatewayPublishConfig[] {
    const shared = sharedConfig(env);
    let bindings: unknown[];
    if (env.GATEWAY_SITE_BINDINGS !== undefined) {
        if (['GATEWAY_CMS_WORKSPACE_ID', 'GATEWAY_CMS_SITE_ID', 'GATEWAY_WORKSPACE_ID', 'GATEWAY_SITE_ID', 'GATEWAY_PUBLIC_SITE_URL']
            .some(key => env[key] !== undefined)) throw new Error('GATEWAY_SITE_BINDINGS cannot be combined with legacy Gateway binding variables');
        try { bindings = JSON.parse(env.GATEWAY_SITE_BINDINGS) as unknown[]; }
        catch { throw new Error('Invalid GATEWAY_SITE_BINDINGS JSON'); }
        if (!Array.isArray(bindings)) throw new Error('GATEWAY_SITE_BINDINGS must be a JSON array');
    } else if (env.GATEWAY_CMS_WORKSPACE_ID || env.GATEWAY_CMS_SITE_ID || env.GATEWAY_WORKSPACE_ID || env.GATEWAY_SITE_ID || env.GATEWAY_PUBLIC_SITE_URL) {
        return [{ ...shared, cmsWorkspaceId: env.GATEWAY_CMS_WORKSPACE_ID || '', cmsSiteId: env.GATEWAY_CMS_SITE_ID || '',
            workspaceId: env.GATEWAY_WORKSPACE_ID || '', siteId: env.GATEWAY_SITE_ID || '', siteUrl: env.GATEWAY_PUBLIC_SITE_URL || '' }];
    } else return [];

    const cmsKeys = new Set<string>();
    const gatewaySites = new Set<string>();
    return bindings.map((binding, index) => {
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
            throw new Error(`Invalid Gateway site binding at index ${index}`);
        }
        const item = binding as Record<string, unknown>;
        const keys = ['cmsWorkspaceId', 'cmsSiteId', 'workspaceId', 'siteId', 'siteUrl'] as const;
        if (Object.keys(item).some(key => !keys.includes(key as typeof keys[number]))) {
            throw new Error(`Unexpected Gateway site binding field at index ${index}`);
        }
        if (keys.some(key => typeof item[key] !== 'string' || !item[key].trim())) {
            throw new Error(`Invalid Gateway site binding at index ${index}`);
        }
        const entry = item as unknown as GatewaySiteBinding;
        const cmsKey = JSON.stringify([entry.cmsWorkspaceId, entry.cmsSiteId]);
        if (cmsKeys.has(cmsKey)) throw new Error('Duplicate CMS site binding');
        if (gatewaySites.has(entry.siteId)) throw new Error('Duplicate Gateway site binding');
        cmsKeys.add(cmsKey);
        gatewaySites.add(entry.siteId);
        const config = { ...shared, cmsWorkspaceId: entry.cmsWorkspaceId, cmsSiteId: entry.cmsSiteId,
            workspaceId: entry.workspaceId, siteId: entry.siteId, siteUrl: entry.siteUrl };
        validateConfig(config);
        return config;
    });
}

export function gatewayPublishConfig(env: NodeJS.ProcessEnv = process.env): GatewayPublishConfig {
    const context = workspaceContext();
    const configs = gatewayPublishConfigs(env);
    if (context) return (context.siteId && configs.find(config => config.cmsWorkspaceId === context.workspaceId && config.cmsSiteId === context.siteId))
        || { ...sharedConfig(env), workspaceId: '', siteId: '',
            cmsWorkspaceId: '', cmsSiteId: '', siteUrl: '' };
    if (env.GATEWAY_SITE_BINDINGS !== undefined) return { ...sharedConfig(env), workspaceId: '', siteId: '',
        cmsWorkspaceId: '', cmsSiteId: '', siteUrl: '' };
    if (configs.length === 1) return configs[0];
    return { ...sharedConfig(env), workspaceId: '', siteId: '', cmsWorkspaceId: '', cmsSiteId: '', siteUrl: '' };
}

export function validateConfig(config: GatewayPublishConfig) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const key of ['workspaceId', 'siteId'] as const) if (!uuid.test(config[key])) throw new Error(`Gateway ${key} must be a UUID`);
    if (!config.cmsWorkspaceId || !config.cmsSiteId || !config.serviceSecret.trim()) throw new Error('Gateway CMS binding and service secret are required');
    let base: URL;
    try { base = new URL(config.gatewayBaseUrl); } catch { throw new Error('Invalid GATEWAY_BASE_URL'); }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
        !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
        throw new Error('Gateway base URL must be HTTPS or loopback HTTP without path or credentials');
    }
    let publicUrl: URL;
    try { publicUrl = new URL(config.siteUrl); } catch { throw new Error('Invalid GATEWAY_PUBLIC_SITE_URL'); }
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
        throw new Error('GATEWAY_PUBLIC_SITE_URL must be an HTTPS origin or URL without credentials');
    }
    return { base, publicUrl };
}

export async function gatewayRequest(fetcher: typeof fetch, url: string, secret: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...init.headers } });
    if (response.status === 409) throw new GatewayRevisionConflict('Gateway rejected a concurrent change; refresh the site state and retry');
    if (!response.ok) {
        let code = '';
        try {
            const failure = await response.json();
            if (typeof failure?.error === 'string' && publicFailureCodes.has(failure.error)) code = failure.error;
        } catch { /* Non-JSON and unrecognized diagnostics remain private. */ }
        throw new Error(`Gateway request failed (${response.status})${code ? `: ${code}` : ''}`);
    }
    const body = await response.json();
    return body;
}
