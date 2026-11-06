import { gatewayPublishConfigs, validateConfig, type GatewayPublishConfig } from '../presets/gateway-client';
import { workspaceContext } from '../workspaces/context';
import type { BindingReader, SiteGatewayBinding } from './model';

type SelectedContext = () => { workspaceId: string; siteId?: string } | undefined;
const identity = (value: { cmsWorkspaceId: string; cmsSiteId: string }) => JSON.stringify([value.cmsWorkspaceId, value.cmsSiteId]);
const target = (value: { workspaceId: string; siteId: string }) => JSON.stringify([value.workspaceId, value.siteId]);

function unconfigured(env: NodeJS.ProcessEnv): GatewayPublishConfig {
    return { gatewayBaseUrl: env.GATEWAY_BASE_URL || '', serviceSecret: env.CMS_SERVICE_SECRET || '',
        workspaceId: '', siteId: '', cmsWorkspaceId: '', cmsSiteId: '', siteUrl: '' };
}

function persistedConfig(binding: SiteGatewayBinding, env: NodeJS.ProcessEnv): GatewayPublishConfig {
    if (!['provisioned', 'legacy'].includes(binding.source)) throw new Error('Invalid Gateway binding source');
    const config: GatewayPublishConfig = { gatewayBaseUrl: env.GATEWAY_BASE_URL || '', serviceSecret: env.CMS_SERVICE_SECRET || '',
        cmsWorkspaceId: binding.cmsWorkspaceId, cmsSiteId: binding.cmsSiteId,
        workspaceId: binding.workspaceId, siteId: binding.siteId, siteUrl: binding.siteUrl,
        ...(binding.source === 'provisioned' ? { sourceHeaders: { 'X-CMS-Workspace': binding.cmsWorkspaceId, 'X-CMS-Site': binding.cmsSiteId } } : {}) };
    validateConfig(config);
    return config;
}

function checkConflict(stored: GatewayPublishConfig, legacy: GatewayPublishConfig) {
    if (identity(stored) === identity(legacy)) {
        if (target(stored) !== target(legacy) || stored.siteUrl !== legacy.siteUrl) throw new Error('Gateway binding conflict');
    } else if (target(stored) === target(legacy)) throw new Error('Gateway binding conflict');
}

/** The injected context is the already verified server workspace context, never request headers. */
export function createGatewayConfigResolver(reader: BindingReader, context: SelectedContext) {
    return async (env: NodeJS.ProcessEnv = process.env): Promise<GatewayPublishConfig> => {
        const legacy = gatewayPublishConfigs(env);
        const selected = context();
        if (!selected?.siteId) {
            // Preserve the old explicit single-binding mode when site selection was deferred.
            return env.GATEWAY_SITE_BINDINGS === undefined && (!selected || legacy[0]?.cmsWorkspaceId === selected.workspaceId)
                ? legacy[0] || unconfigured(env) : unconfigured(env);
        }
        const existing = legacy.find(item => item.cmsWorkspaceId === selected.workspaceId && item.cmsSiteId === selected.siteId);
        if (!env.GATEWAY_BASE_URL && !env.CMS_SERVICE_SECRET && !legacy.length) return unconfigured(env);
        const binding = await reader.find(selected.workspaceId, selected.siteId);
        if (!binding) return existing || unconfigured(env);
        if (binding.cmsWorkspaceId !== selected.workspaceId || binding.cmsSiteId !== selected.siteId) throw new Error('Gateway binding identity mismatch');
        const config = persistedConfig(binding, env);
        for (const item of legacy) checkConflict(config, item);
        return config;
    };
}

/** Background enumeration uses explicit identities and establishes a context separately per item. */
export function createGatewayConfigsLoader(reader: BindingReader) {
    return async (env: NodeJS.ProcessEnv = process.env): Promise<GatewayPublishConfig[]> => {
        const configs = gatewayPublishConfigs(env);
        const provisioned = await reader.listProvisioned();
        for (const binding of provisioned) {
            const config = persistedConfig(binding, env);
            for (const item of configs) checkConflict(config, item);
            const index = configs.findIndex(item => identity(item) === identity(config));
            if (index < 0) configs.push(config);
            else configs[index] = config;
        }
        return configs;
    };
}

// Keep importing the pure factories free of repository initialization and live connections.
const runtimeReader: BindingReader = {
    async find(workspace, site) { const { Repo } = await import('../repo'); return Repo.siteGatewayBinding.methods.find(workspace, site); },
    async listProvisioned() { const { Repo } = await import('../repo'); return Repo.siteGatewayBinding.methods.listProvisioned(); },
};
export const resolveGatewayPublishConfig = createGatewayConfigResolver(runtimeReader, workspaceContext);
export const resolveGatewayPublishConfigs = createGatewayConfigsLoader(runtimeReader);
