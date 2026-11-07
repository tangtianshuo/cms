import { resolveGatewayPublishConfig } from '../site-provisioning/config';
import { ownerWorkspace } from '../workspaces/context';
import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Config } from '../config';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import type { ReleaseSnapshot } from './releases';
import { buildRelease, publishRelease, releaseDiff, rollbackRelease, ReleaseValidationError } from './releases';
import { gatewayBound, GatewayRevisionConflict, publishGatewayRelease, readGatewayOperation,
    publicRecord } from './gateway-publish';
import { isGatewayUnavailable, type GatewayPublishConfig } from './gateway-client';
import type { SiteInstallation } from './site-model';
import { releaseSource } from './release-source';
export { releaseSource } from './release-source';
import { reconcileGatewayState, snapshotFingerprint } from './gateway-state';
import { recoverGatewayPublication } from './gateway-recovery';
import { observeGatewayPublication } from './gateway-observation';
import { withSiteMutation } from '../template-contract/site-mutation';

const publishBody = z.object({ expectedReleaseId: z.string(), target: z.literal('gateway').optional(), requestKey: z.string().optional(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

// Provisioned sites must use their durable mapping; a legacy environment binding cannot
// turn incomplete preparation into a local snapshot publication.
async function releaseGateway(site: SiteInstallation | null, resolveLegacy = true): Promise<{
    config: GatewayPublishConfig | null;
    preparation?: { status: NonNullable<SiteInstallation['provisioning']>['status']; allowed: boolean };
}> {
    if (!site?.provisioning) return { config: resolveLegacy ? await resolveGatewayPublishConfig() : null };
    const preparation = { status: site.provisioning.status, allowed: false };
    if (preparation.status !== 'ready') return { config: null, preparation };
    try {
        const binding = await Repo.siteGatewayBinding.methods.find(ownerWorkspace(site), site._id);
        if (!binding || binding.source !== 'provisioned') return { config: null, preparation };
        const config = await resolveGatewayPublishConfig();
        if (!gatewayBound(site, config) || config.workspaceId !== binding.workspaceId || config.siteId !== binding.siteId ||
            config.siteUrl !== binding.siteUrl) return { config: null, preparation };
        return { config, preparation: { ...preparation, allowed: true } };
    } catch { return { config: null, preparation }; }
}

export const ReleaseController = createController({
    name: 'StorefrontReleases',
    path: '/api/v4/presets/releases',
    methods() {
        return {
            gatewayObservation: createControllerMethod({
                path: '/gateway/observation', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'),
                async handler({ request, reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    const query = z.object({ marker: z.string().min(1).max(256).optional() }).strict().safeParse(request.query);
                    if (!query.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid publication observation query');
                    return observeGatewayPublication({
                        findSite: () => Repo.siteInstallation.methods.findSelected(),
                        findRelease: id => Repo.storefrontRelease.findById(id),
                    }, await resolveGatewayPublishConfig(), query.data.marker);
                },
            }),
            gateway: createControllerMethod({
                path: '/gateway', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    let site = await Repo.siteInstallation.methods.findSelected();
                    const { config, preparation } = await releaseGateway(site);
                    let gatewayUnavailable = false;
                    if (site && config && gatewayBound(site, config)) {
                        try { site = await recoverGatewayPublication(releaseSource(), config); }
                        catch (cause) { if (!isGatewayUnavailable(cause)) throw cause; gatewayUnavailable = true; }
                    }
                    let publishStatus: { operationId: string; releaseId: string; requestKey: string; status: string; failureCode?: string; reason?: string; activeRevision?: number; operation?: 'publish' | 'rollback' } | null = null;
                    if (site?.gatewayPublishIntent) {
                        try {
                            const intent = JSON.parse(site.gatewayPublishIntent);
                            if (typeof intent.requestKey === 'string' && typeof intent.releaseId === 'string' &&
                                ['pending', 'ready', 'failed'].includes(intent.status)) {
                                publishStatus = { operationId: typeof intent.operationId === 'string' ? intent.operationId : '',
                                    releaseId: intent.releaseId, requestKey: intent.requestKey,
                                    status: intent.status, activeRevision: site?.gatewayActiveRevision || 0,
                                    ...(intent.operation === 'rollback' ? { operation: 'rollback' as const } : {}),
                                    ...(intent.failureCode ? { failureCode: intent.failureCode, reason: intent.failureCode } : {}) };
                            }
                        } catch { /* malformed intents fail on publish or status request */ }
                    }
                    if (gatewayUnavailable && publishStatus) publishStatus = { ...publishStatus, status: 'unknown', failureCode: 'gateway_unavailable', reason: 'gateway_unavailable' };
                    const domains = site?.primaryDomainId ? await Repo.siteDomain.methods.list(site._id) : [];
                    const primary = domains.find(domain => domain._id === site?.primaryDomainId && domain.enabled && domain.ownershipStatus === 'verified' && domain.connectionStatus === 'ready');
                    const publicHostname = primary?.hostname || (site && ownerWorkspace(site) === 'default' && site.slot === 'default' ? Config.storefrontHost : undefined);
                    return { configured: !!config?.gatewayBaseUrl && !!config.workspaceId && !!config.siteId &&
                        !!config.serviceSecret && !!config.cmsWorkspaceId && !!config.cmsSiteId && !!config.siteUrl,
                    bound: !!config && gatewayBound(site, config), siteUrl: config?.siteUrl || '', publicHostname, defaultHost: Config.storefrontHost, publishStatus,
                    ...(preparation ? { preparation } : {}) };
                },
            }),
            gatewayOperation: createControllerMethod({
                path: '/gateway/operations/:operationId', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'),
                async handler({ request, reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    const config = await resolveGatewayPublishConfig();
                    if (!site || !gatewayBound(site, config)) throw errorHandler(HttpStatus.NotFound, 'Gateway publication not found');
                    const { operationId } = request.params as { operationId: string };
                    try { return await readGatewayOperation(releaseSource(), site, operationId, config); }
                    catch (cause) { throw errorHandler(HttpStatus.NotFound, cause instanceof Error ? cause.message : 'Gateway publication not found'); }
                },
            }),
            history: createControllerMethod({
                path: '/', type: 'get', preRequestHandler: RP.createSiteCapabilityCheck('operations.read'),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    let site = await Repo.siteInstallation.methods.findSelected();
                    const { config } = await releaseGateway(site);
                    const bound = !!config && gatewayBound(site, config);
                    if (site && bound && config) {
                        try { site = await recoverGatewayPublication(releaseSource(), config); }
                        catch (cause) { if (!isGatewayUnavailable(cause)) throw cause; }
                    }
                    if (!site) return { currentReleaseId: '', items: [], audit: [] };
                    const published = bound ? site.gatewayPublishedReleaseIds || [] : site.publishedReleaseIds || [site.currentReleaseId];
                    const records = await Repo.storefrontRelease.methods.findBySite(site._id);
                    return { currentReleaseId: (bound ? site.gatewayCurrentReleaseId : site.currentReleaseId) || '',
                        items: records.filter((record) => published.includes(record._id)).map((record) => ({
                            _id: record._id, createdAt: record.createdAt, createdBy: record.createdBy,
                            pageCount: (JSON.parse(record.payload) as ReleaseSnapshot).pages.length,
                            templateVersion: record.templateRecord ? JSON.parse(record.templateRecord).version : site.presetVersion,
                        })), audit: await Repo.storefrontReleaseAudit.methods.findBySite(site._id) };
                },
            }),
            check: createControllerMethod({
                path: '/check', type: 'post', preRequestHandler: RP.createSiteCapabilityCheck('publish'),
                async handler({ reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    const source = releaseSource();
                    const site = await source.findSite();
                    const { config, preparation } = await releaseGateway(site);
                    if (preparation && !preparation.allowed) throw errorHandler(HttpStatus.Conflict, 'Site publication environment is not ready');
                    try {
                        if (!Config.storefrontEnabled) throw new Error('Storefront is disabled');
                        if (!site) throw new Error('Site is not installed');
                        const bound = !!config && gatewayBound(site, config);
                        if (bound && config) await reconcileGatewayState(source, site, config);
                        const currentId = bound ? site.gatewayCurrentReleaseId : site.currentReleaseId;
                        const current = currentId ? await source.findRelease(currentId) : null;
                        if (current && (current.siteId !== site._id || ownerWorkspace(current) !== ownerWorkspace(site))) throw new Error('Release belongs to another site');
                        const previous = current ? JSON.parse(current.payload) as ReleaseSnapshot : undefined;
                        if (previous && (previous.siteId !== site._id || ownerWorkspace(previous) !== ownerWorkspace(site))) throw new Error('Release snapshot belongs to another site');
                        const snapshot = buildRelease({ ...await source.loadContent(site), site, previous });
                        return { valid: true, issues: [], issueDetails: [], expectedReleaseId: currentId || '',
                            snapshotHash: snapshotFingerprint(snapshot, bound ? publicRecord(site) : undefined),
                            pageCount: snapshot.pages.length, diff: releaseDiff(previous, snapshot) };
                    } catch (cause) {
                        const issueDetails = cause instanceof ReleaseValidationError ? cause.issues : [{ code: 'release-invalid', message: cause instanceof Error ? cause.message : 'Validation failed' }];
                        return { valid: false, issues: issueDetails.map(issue => issue.message), issueDetails,
                            expectedReleaseId: (config && gatewayBound(site, config) ? site?.gatewayCurrentReleaseId : site?.currentReleaseId) || '', pageCount: 0, diff: null };
                    }
                },
            }),
            publish: createControllerMethod({
                path: '/publish', type: 'post', preRequestHandler: RP.createSiteCapabilityCheck('publish'),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.safeParse(request.body);
                    if (!parsed.success || !Config.storefrontEnabled) throw errorHandler(HttpStatus.BadRequest, 'Invalid publication request or storefront disabled');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    const { config, preparation } = await releaseGateway(site, parsed.data.target === 'gateway');
                    if (preparation && (!preparation.allowed || parsed.data.target !== 'gateway')) throw errorHandler(HttpStatus.Conflict, 'Site publication environment is not ready');
                    if (!site) throw errorHandler(HttpStatus.NotFound, 'Site not found');
                    try {
                        return await withSiteMutation(site._id, async () => {
                            if (parsed.data.target === 'gateway') {
                                if (!parsed.data.requestKey) throw new Error('Gateway publication requestKey is required');
                                if (!config) throw new Error('Site publication environment is not ready');
                                return await publishGatewayRelease(releaseSource(), token.payload.userId,
                                    parsed.data.expectedReleaseId, parsed.data.requestKey, config, fetch, buildRelease,
                                    { snapshotHash: parsed.data.snapshotHash });
                            }
                            const record = await publishRelease(releaseSource(), token.payload.userId, parsed.data.expectedReleaseId, parsed.data.snapshotHash);
                            return { releaseId: record._id };
                        });
                    } catch (cause) {
                        throw errorHandler(cause instanceof GatewayRevisionConflict ? HttpStatus.Conflict : HttpStatus.BadRequest,
                            cause instanceof Error ? cause.message : 'Publication failed');
                    }
                },
            }),
            rollback: createControllerMethod({
                path: '/rollback', type: 'post', preRequestHandler: RP.createSiteCapabilityCheck('publish'),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.extend({ releaseId: z.string().min(1) }).safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid rollback request');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    const { config, preparation } = await releaseGateway(site);
                    if (preparation && !preparation.allowed) throw errorHandler(HttpStatus.Conflict, 'Site publication environment is not ready');
                    if (!site) throw errorHandler(HttpStatus.NotFound, 'Site not found');
                    try {
                        return await withSiteMutation(site._id, async () => {
                            if (config && gatewayBound(site, config)) {
                                if (!parsed.data.requestKey) throw new Error('Gateway rollback requestKey is required');
                                return await publishGatewayRelease(releaseSource(), token.payload.userId,
                                    parsed.data.expectedReleaseId, parsed.data.requestKey, config, fetch, buildRelease,
                                    { restoreReleaseId: parsed.data.releaseId });
                            }
                            await rollbackRelease(releaseSource(), token.payload.userId, parsed.data.releaseId, parsed.data.expectedReleaseId);
                            return { releaseId: parsed.data.releaseId };
                        });
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Rollback failed');
                    }
                },
            }),
        };
    },
});
