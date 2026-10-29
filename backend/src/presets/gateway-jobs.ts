import type { Module } from '../_server';
import { Config } from '../config';
import { runWithWorkspace } from '../workspaces/context';
import { gatewayPublishConfigs, type GatewayPublishConfig } from './gateway-client';
import { gatewayBound } from './gateway-publish';
import { recoverGatewayPublication } from './gateway-recovery';
import { releaseSource } from './release-source';

type RecoveryAction = (config: GatewayPublishConfig) => Promise<void>;
type RecoveryErrorHandler = (cause: unknown) => void;

export function withGatewayRecoveryWorkspace<T>(config: GatewayPublishConfig, action: () => Promise<T>) {
    return runWithWorkspace({ workspaceId: config.cmsWorkspaceId, siteId: config.cmsSiteId,
        actorId: '__gateway-recovery', admin: true, instanceAdmin: true, role: 'admin' }, action);
}

async function recoverBinding(config: GatewayPublishConfig) {
    await withGatewayRecoveryWorkspace(config, async () => {
        const source = releaseSource();
        if (gatewayBound(await source.findSite(), config)) await recoverGatewayPublication(source, config);
    });
}

function reportRecoveryFailure(cause: unknown) {
    console.error('Gateway publication recovery deferred', cause instanceof Error ? cause.message : 'Unknown error');
}

export async function runGatewayRecoveryTick(
    loadConfigs: () => GatewayPublishConfig[] = gatewayPublishConfigs,
    recover: RecoveryAction = recoverBinding,
    report: RecoveryErrorHandler = reportRecoveryFailure,
) {
    let configs: GatewayPublishConfig[];
    try { configs = loadConfigs(); }
    catch (cause) { report(cause); return; }
    for (const config of configs) {
        try { await recover(config); }
        catch (cause) { report(cause); }
    }
}

export function createGatewayReconciliationJob(): Module {
    return { name: 'Gateway publication recovery', initialize({ fastify, next }) {
        let running = false;
        let stopped = false;
        async function tick() {
            if (running || stopped || !Config.storefrontEnabled) return;
            running = true;
            try {
                await runGatewayRecoveryTick();
            } finally { running = false; }
        }
        const timer = setInterval(() => { void tick(); }, 15000);
        timer.unref();
        fastify.addHook('onClose', async () => { stopped = true; clearInterval(timer); });
        next();
    } };
}
