import { ownerWorkspace } from '../workspaces/context';
import { z } from 'zod';
import { createController, createControllerMethod, HttpStatus } from '../_server';
import { Config } from '../config';
import { Repo } from '../repo';
import { RP } from '../security/route-protection/main';
import type { ReleaseSnapshot } from './releases';
import { buildRelease, publishRelease, releaseDiff, rollbackRelease, ReleaseValidationError } from './releases';
import { gatewayBound, gatewayPublishConfig, GatewayRevisionConflict, publishGatewayRelease, readGatewayOperation,
    publicRecord } from './gateway-publish';
import { releaseSource } from './release-source';
export { releaseSource } from './release-source';
import { reconcileGatewayState, snapshotFingerprint } from './gateway-state';
import { recoverGatewayPublication } from './gateway-recovery';

const publishBody = z.object({ expectedReleaseId: z.string(), target: z.literal('gateway').optional(), requestKey: z.string().optional(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

export const ReleaseController = createController({
    name: 'StorefrontReleases',
    path: '/api/v4/presets/releases',
    methods() {
        return {
            gateway: createControllerMethod({
                path: '/gateway', type: 'get', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const config = gatewayPublishConfig();
                    let site = await Repo.siteInstallation.methods.findSelected();
                    if (site && gatewayBound(site, config)) site = await recoverGatewayPublication(releaseSource(), config);
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
                    const domains = site?.primaryDomainId ? await Repo.siteDomain.methods.list(site._id) : [];
                    const primary = domains.find(domain => domain._id === site?.primaryDomainId && domain.enabled && domain.ownershipStatus === 'verified' && domain.connectionStatus === 'ready');
                    const publicHostname = primary?.hostname || (site && ownerWorkspace(site) === 'default' && site.slot === 'default' ? Config.storefrontHost : undefined);
                    return { configured: !!config.gatewayBaseUrl && !!config.workspaceId && !!config.siteId &&
                        !!config.serviceSecret && !!config.cmsWorkspaceId && !!config.cmsSiteId && !!config.siteUrl,
                    bound: gatewayBound(site, config), siteUrl: config.siteUrl, publicHostname, defaultHost: Config.storefrontHost, publishStatus };
                },
            }),
            gatewayOperation: createControllerMethod({
                path: '/gateway/operations/:operationId', type: 'get', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, reply, errorHandler }) {
                    reply.header('Cache-Control', 'no-store');
                    const site = await Repo.siteInstallation.methods.findSelected();
                    const config = gatewayPublishConfig();
                    if (!site || !gatewayBound(site, config)) throw errorHandler(HttpStatus.NotFound, 'Gateway publication not found');
                    const { operationId } = request.params as { operationId: string };
                    try { return await readGatewayOperation(releaseSource(), site, operationId, config); }
                    catch (cause) { throw errorHandler(HttpStatus.NotFound, cause instanceof Error ? cause.message : 'Gateway publication not found'); }
                },
            }),
            history: createControllerMethod({
                path: '/', type: 'get', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    let site = await Repo.siteInstallation.methods.findSelected();
                    const config = gatewayPublishConfig();
                    const bound = gatewayBound(site, config);
                    if (site && bound) site = await recoverGatewayPublication(releaseSource(), config);
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
                path: '/check', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const source = releaseSource();
                    const site = await source.findSite();
                    try {
                        if (!Config.storefrontEnabled) throw new Error('Storefront is disabled');
                        if (!site) throw new Error('Site is not installed');
                        const config = gatewayPublishConfig();
                        const bound = gatewayBound(site, config);
                        if (bound) await reconcileGatewayState(source, site, config);
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
                            expectedReleaseId: (gatewayBound(site, gatewayPublishConfig()) ? site?.gatewayCurrentReleaseId : site?.currentReleaseId) || '', pageCount: 0, diff: null };
                    }
                },
            }),
            publish: createControllerMethod({
                path: '/publish', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.safeParse(request.body);
                    if (!parsed.success || !Config.storefrontEnabled) throw errorHandler(HttpStatus.BadRequest, 'Invalid publication request or storefront disabled');
                    try {
                        if (parsed.data.target === 'gateway') {
                            if (!parsed.data.requestKey) throw new Error('Gateway publication requestKey is required');
                            return await publishGatewayRelease(releaseSource(), token.payload.userId,
                                parsed.data.expectedReleaseId, parsed.data.requestKey, gatewayPublishConfig(), fetch, buildRelease,
                                { snapshotHash: parsed.data.snapshotHash });
                        }
                        const record = await publishRelease(releaseSource(), token.payload.userId, parsed.data.expectedReleaseId, parsed.data.snapshotHash);
                        return { releaseId: record._id };
                    } catch (cause) {
                        throw errorHandler(cause instanceof GatewayRevisionConflict ? HttpStatus.Conflict : HttpStatus.BadRequest,
                            cause instanceof Error ? cause.message : 'Publication failed');
                    }
                },
            }),
            rollback: createControllerMethod({
                path: '/rollback', type: 'post', preRequestHandler: RP.createWorkspaceAdminCheck(),
                async handler({ request, token, errorHandler, reply }) {
                    reply.header('Cache-Control', 'no-store');
                    const parsed = publishBody.extend({ releaseId: z.string().min(1) }).safeParse(request.body);
                    if (!parsed.success) throw errorHandler(HttpStatus.BadRequest, 'Invalid rollback request');
                    try {
                        const config = gatewayPublishConfig();
                        if (gatewayBound(await Repo.siteInstallation.methods.findSelected(), config)) {
                            if (!parsed.data.requestKey) throw new Error('Gateway rollback requestKey is required');
                            return await publishGatewayRelease(releaseSource(), token.payload.userId,
                                parsed.data.expectedReleaseId, parsed.data.requestKey, config, fetch, buildRelease,
                                { restoreReleaseId: parsed.data.releaseId });
                        }
                        await rollbackRelease(releaseSource(), token.payload.userId, parsed.data.releaseId, parsed.data.expectedReleaseId);
                        return { releaseId: parsed.data.releaseId };
                    } catch (cause) {
                        throw errorHandler(HttpStatus.BadRequest, cause instanceof Error ? cause.message : 'Rollback failed');
                    }
                },
            }),
        };
    },
});
