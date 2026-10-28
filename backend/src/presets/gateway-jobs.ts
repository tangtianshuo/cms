import type { Module } from '../_server';
import { Config } from '../config';
import { runWithWorkspace } from '../workspaces/context';
import { gatewayPublishConfig } from './gateway-client';
import { gatewayBound } from './gateway-publish';
import { recoverGatewayPublication } from './gateway-recovery';
import { releaseSource } from './release-source';

export function createGatewayReconciliationJob(): Module {
    return { name: 'Gateway publication recovery', initialize({ fastify, next }) {
        let running = false;
        let stopped = false;
        async function tick() {
            if (running || stopped || !Config.storefrontEnabled) return;
            const config = gatewayPublishConfig();
            if (!config.cmsWorkspaceId || !config.cmsSiteId) return;
            running = true;
            try {
                await runWithWorkspace({ workspaceId: config.cmsWorkspaceId, siteId: config.cmsSiteId,
                    actorId: '__gateway-recovery', admin: true, instanceAdmin: true, role: 'admin' }, async () => {
                    const source = releaseSource();
                    if (gatewayBound(await source.findSite(), config)) await recoverGatewayPublication(source, config);
                });
            } catch (cause) {
                console.error('Gateway publication recovery deferred', cause instanceof Error ? cause.message : 'Unknown error');
            } finally { running = false; }
        }
        const timer = setInterval(() => { void tick(); }, 15000);
        timer.unref();
        fastify.addHook('onClose', async () => { stopped = true; clearInterval(timer); });
        next();
    } };
}
