import { createHash } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { buildRelease } from './releases';
import { publishGatewayRelease, readGatewayOperation, type GatewayPublishConfig,
    type GatewayPublishIntent, type GatewayReleaseSource } from './gateway-publish';
import { reconcileGatewayState } from './gateway-state';

/** Recovery runs without the browser: reconcile active media, then resume the same frozen request. */
export async function recoverGatewayPublication(source: GatewayReleaseSource, config: GatewayPublishConfig, fetcher: typeof fetch = fetch) {
    let site = await source.findSite();
    if (!site) return null;
    await reconcileGatewayState(source, site, config, fetcher);
    site = (await source.findSite()) || site;
    const intent = site.gatewayPublishIntent ? JSON.parse(site.gatewayPublishIntent) as GatewayPublishIntent : null;
    if (!intent) return site;
    if (intent.operationId && intent.status !== 'failed') {
        await readGatewayOperation(source, site, intent.operationId, config, fetcher);
    } else if (intent.status !== 'failed' && intent.status !== 'ready') {
        await publishGatewayRelease(source, intent.actorId || 'legacy-gateway', intent.expectedReleaseId,
            intent.requestKey, config, fetcher, buildRelease, { restoreReleaseId: intent.sourceReleaseId });
    }
    site = (await source.findSite()) || site;
    const latest = site.gatewayPublishIntent ? JSON.parse(site.gatewayPublishIntent) as GatewayPublishIntent : null;
    if (latest?.status === 'failed') {
        const now = Date.now();
        await source.audit({ _id: createHash('sha256').update(`gateway-failed:${site._id}:${latest.releaseId}`).digest('hex'),
            siteId: site._id, workspaceId: ownerWorkspace(site), createdAt: now, updatedAt: now,
            actorId: latest.actorId || 'legacy-gateway', operation: latest.operation || 'publish',
            releaseId: latest.releaseId, error: latest.failureCode || 'Gateway publication failed' });
    }
    return site;
}
