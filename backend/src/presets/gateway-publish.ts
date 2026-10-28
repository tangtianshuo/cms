import { GatewayRevisionConflict, gatewayRequest, validateConfig, type GatewayPublishConfig } from './gateway-client';
export { gatewayPublishConfig, GatewayRevisionConflict, type GatewayPublishConfig } from './gateway-client';
import { createHash, randomUUID } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { MediaRetentionError } from '../media/retention';
import { buildRelease, type ReleaseSnapshot, type ReleaseSource } from './releases';
import type { PublicTemplateRecord } from './registry';
import type { SiteInstallation } from './site-model';
import { cmsSnapshot, reconcileGatewayState, retainGatewaySnapshot, snapshotFingerprint } from './gateway-state';

export interface GatewayPublishIntent {
    requestKey: string;
    expectedReleaseId: string;
    releaseId: string;
    idempotencyKey: string;
    revision: number;
    snapshot: string;
    checksum: string;
    record: PublicTemplateRecord;
    operationId?: string;
    status?: 'pending' | 'ready' | 'failed';
    failureCode?: string;
    actorId?: string;
    createdAt?: number;
    operation?: 'publish' | 'rollback';
    sourceReleaseId?: string;
}

export interface GatewayReleaseSource extends ReleaseSource {
    saveSite(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
    projectGatewayRelease(site: SiteInstallation, releaseId: string, revision: number): Promise<boolean>;
}

export function publicRecord(site: SiteInstallation): PublicTemplateRecord {
    if (!site.publishedTemplateRecord || !site.presetManifestSnapshot) throw new Error('Site has no verified public template');
    let value: unknown;
    try { value = JSON.parse(site.publishedTemplateRecord); } catch { throw new Error('Installed public template record is invalid'); }
    if (!value || typeof value !== 'object') throw new Error('Installed public template record is invalid');
    const record = value as PublicTemplateRecord;
    if (record.schemaVersion !== 1 || record.status !== 'available' || record.id !== site.presetId || record.version !== site.presetVersion ||
        record.imageRepository !== `ghcr.io/tangtianshuo/independent-website-templates/${record.id}` ||
        !/^sha256:[a-f0-9]{64}$/.test(record.manifestChecksum) || !/^sha256:[a-f0-9]{64}$/.test(record.imageDigest) ||
        !/^[a-f0-9]{40}$/.test(record.sourceCommit) || record.manifestPath !== `templates/${record.id}/${record.version}/template.json`) {
        throw new Error('Installed public template record does not match the approved registry identity');
    }
    let manifest: unknown;
    try { manifest = JSON.parse(site.presetManifestSnapshot); } catch { throw new Error('Installed public template snapshot is invalid'); }
    if (!manifest || typeof manifest !== 'object' || (manifest as { id?: string }).id !== record.id ||
        (manifest as { version?: string }).version !== record.version) throw new Error('Installed public template snapshot does not match its record');
    return record;
}

function parseIntent(site: SiteInstallation): GatewayPublishIntent | null {
    if (!site.gatewayPublishIntent) return null;
    try {
        const intent = JSON.parse(site.gatewayPublishIntent) as GatewayPublishIntent;
        if (typeof intent.requestKey !== 'string' || typeof intent.releaseId !== 'string' || typeof intent.snapshot !== 'string' ||
            typeof intent.checksum !== 'string' || !Number.isSafeInteger(intent.revision) ||
            !intent.record || intent.record.id !== site.presetId || typeof intent.record.version !== 'string') throw new Error();
        return intent;
    } catch { throw new Error('Stored Gateway publication intent is invalid'); }
}

function identityMatches(value: unknown, record: PublicTemplateRecord): boolean {
    if (!value || typeof value !== 'object') return false;
    const result = value as Record<string, unknown>;
    return result.schemaVersion === 1 && result.id === record.id && result.templateId === record.id &&
        result.version === record.version && result.templateVersion === record.version &&
        result.manifestChecksum === record.manifestChecksum && result.imageRepository === record.imageRepository &&
        result.imageDigest === record.imageDigest && result.sourceCommit === record.sourceCommit &&
        result.manifestPath === record.manifestPath && result.status === record.status;
}

function responseIntent(intent: GatewayPublishIntent) {
    return { releaseId: intent.releaseId, operationId: intent.operationId || '', status: intent.status || 'pending' };
}

export async function publishGatewayRelease(
    source: GatewayReleaseSource, actorId: string, expectedReleaseId: string, requestKey: string,
    config: GatewayPublishConfig, fetcher: typeof fetch = fetch, build: typeof buildRelease = buildRelease,
    options: { snapshotHash?: string; restoreReleaseId?: string } = {},
) {
    const { base } = validateConfig(config);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
        throw new Error('A stable requestKey UUID is required');
    }
    const site = await source.findSite();
    if (!site || site.status !== 'ready') throw new Error('Site is not ready');
    if (site._id !== config.cmsSiteId || (site.workspaceId || 'default') !== config.cmsWorkspaceId) throw new Error('This CMS site is not bound to the configured Gateway target');
    if (!options.restoreReleaseId) publicRecord(site);
    let intent = parseIntent(site);
    if (intent?.requestKey === requestKey && (intent.expectedReleaseId !== expectedReleaseId ||
        (intent.sourceReleaseId || '') !== (options.restoreReleaseId || ''))) {
        throw new Error('This requestKey already belongs to a different publication action');
    }
    // A lost response must replay the same frozen action, even after it became active.
    if (intent?.requestKey === requestKey && intent.expectedReleaseId === expectedReleaseId && intent.operationId) {
        if (!sameRecord(intent.record, publicRecord(site)) && !options.restoreReleaseId) throw new Error('A persisted Gateway publication cannot change its immutable template record');
        if (intent.status === 'ready') {
            const confirmed = await readGatewayOperation(source, site, intent.operationId, config, fetcher);
            return { ...responseIntent(intent), status: confirmed.status || 'pending' };
        }
        return responseIntent(intent);
    }
    if (intent && intent.status !== 'ready' && intent.status !== 'failed' && intent.requestKey !== requestKey) throw new Error('A Gateway publication is still pending');
    const gatewayState = await reconcileGatewayState(source, site, config, fetcher);
    const replayingActive = intent?.requestKey === requestKey && intent.expectedReleaseId === expectedReleaseId && gatewayState.active?.releaseId === intent.releaseId;
    if (!replayingActive && (site.gatewayCurrentReleaseId || '') !== expectedReleaseId) throw new Error('Published site changed; refresh before continuing');
    const previous = site.gatewayCurrentReleaseId ? await source.findRelease(site.gatewayCurrentReleaseId) : null;
    if (previous && (previous.siteId !== site._id || ownerWorkspace(previous) !== ownerWorkspace(site))) throw new Error('Release belongs to another site');
    const prior = previous ? JSON.parse(previous.payload) as ReleaseSnapshot : undefined;
    if (prior && (prior.siteId !== site._id || ownerWorkspace(prior) !== ownerWorkspace(site))) throw new Error('Release snapshot belongs to another site');
    const restoring = options.restoreReleaseId ? await source.findRelease(options.restoreReleaseId) : null;
    if (options.restoreReleaseId && (!restoring || restoring.target !== 'gateway' || restoring.siteId !== site._id ||
        ownerWorkspace(restoring) !== ownerWorkspace(site) || !site.gatewayPublishedReleaseIds?.includes(restoring._id) || !restoring.templateRecord)) {
        throw new Error('Gateway rollback target was never published for this site');
    }
    const restoredTemplate = restoring ? JSON.parse(restoring.templateRecord!) as PublicTemplateRecord : undefined;
    const record = restoredTemplate ? publicRecord({ ...site,
        presetId: restoredTemplate.id, presetVersion: restoredTemplate.version,
        publishedTemplateRecord: restoring!.templateRecord,
        presetManifestSnapshot: JSON.stringify({ id: restoredTemplate.id, version: restoredTemplate.version }) }) : publicRecord(site);
    const target = `${base.origin}/api/v1/sites/${config.siteId}`;
    if (intent && intent.record.id === record.id && intent.record.version === record.version && !sameRecord(intent.record, record)) {
        throw new Error('A persisted Gateway publication cannot change the immutable template record for the same version');
    }
    if (intent && !sameRecord(intent.record, record) &&
        (intent.status === 'pending' || intent.status === undefined || intent.requestKey === requestKey)) {
        throw new Error('A pending Gateway publication is pinned to the previous template version');
    }
    if (intent?.requestKey === requestKey && intent.expectedReleaseId === expectedReleaseId && intent.operationId) {
        return responseIntent(intent);
    }
    if (intent?.requestKey === requestKey && intent.failureCode === 'revision_conflict') {
        throw new GatewayRevisionConflict('Gateway revision conflict; start a new publication after reviewing the current site state');
    }
    if (intent && intent.status !== 'ready' && intent.status !== 'failed' && intent.requestKey !== requestKey) throw new Error('A Gateway publication is still pending');
    if (!intent || intent.requestKey !== requestKey || intent.expectedReleaseId !== expectedReleaseId) {
        const revision = gatewayState.revision;
        const snapshot = cmsSnapshot(restoring ? JSON.parse(restoring.payload) : build({ ...await source.loadContent(site), site, previous: prior }), site);
        if (options.snapshotHash && options.snapshotHash !== snapshotFingerprint(snapshot, record)) throw new Error('Draft content changed after validation; check again before publishing');
        const bytes = Buffer.from(JSON.stringify({ ...snapshot, workspaceId: config.workspaceId, siteId: config.siteId }), 'utf8');
        intent = {
            requestKey, expectedReleaseId, releaseId: randomUUID(), idempotencyKey: requestKey,
            revision, snapshot: bytes.toString('base64'), status: 'pending',
            checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, record,
            actorId, createdAt: Date.now(), operation: restoring ? 'rollback' : 'publish', sourceReleaseId: restoring?._id,
        };
        const prepared = { ...site, gatewayPublishIntent: JSON.stringify(intent), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
        if (!await source.saveSite(prepared, site.updatedAt)) throw new Error('CMS site changed while preparing Gateway publication');
        Object.assign(site, prepared);
    }
    const now = Date.now();
    try {
        await retainGatewaySnapshot(source, { _id: intent.releaseId, workspaceId: ownerWorkspace(site), siteId: site._id,
            createdAt: intent.createdAt || now, updatedAt: now, createdBy: intent.actorId || actorId,
            previousReleaseId: intent.expectedReleaseId, payload: JSON.stringify(cmsSnapshot(JSON.parse(Buffer.from(intent.snapshot, 'base64').toString('utf8')), site)),
            target: 'gateway', templateRecord: JSON.stringify(intent.record), requestKey: intent.requestKey, sourceReleaseId: intent.sourceReleaseId });
    } catch (cause) {
        if (cause instanceof MediaRetentionError) {
            const failed = { ...site, gatewayPublishIntent: JSON.stringify({ ...intent, status: 'failed', failureCode: 'media_retention_failed' }),
                updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
            await source.saveSite(failed, site.updatedAt);
        }
        throw cause;
    }
    // Reserve and retain the immutable action before mutating the shared Gateway pin.
    // Reconfirm it on every upload attempt; a cached pin cannot prove external state.
    const pin = await gatewayRequest(fetcher, `${target}/template-pin`, config.serviceSecret, {
        method: 'PUT', body: JSON.stringify({ templateId: intent.record.id, templateVersion: intent.record.version }),
    });
    if (!identityMatches(pin, intent.record)) throw new Error('Gateway template pin does not match the approved public template record');
    const pinIdentity = site.gatewayPinnedTemplateRecord ? JSON.parse(site.gatewayPinnedTemplateRecord) : null;
    if (!identityMatches(pinIdentity, intent.record)) {
        const pinnedSite = { ...site, gatewayPinnedTemplateRecord: JSON.stringify(pin), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
        if (!await source.saveSite(pinnedSite, site.updatedAt)) throw new Error('CMS site changed while binding its Gateway template');
        Object.assign(site, pinnedSite);
    }
    await gatewayRequest(fetcher, `${target}/releases`, config.serviceSecret, { method: 'POST', body: JSON.stringify({
        siteId: config.siteId, releaseId: intent.releaseId, checksum: intent.checksum,
        metadata: { templateId: intent.record.id, templateVersion: intent.record.version,
            manifestChecksum: intent.record.manifestChecksum, imageDigest: intent.record.imageDigest,
            imageRepository: intent.record.imageRepository, sourceCommit: intent.record.sourceCommit },
        snapshot: intent.snapshot,
    }) });
    const submitting = { ...site, gatewayPublishIntent: JSON.stringify({ ...intent, status: 'pending' }),
        updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
    if (!await source.saveSite(submitting, site.updatedAt)) throw new Error('CMS site changed while submitting Gateway publication');
    Object.assign(site, submitting);
    let operation: unknown;
    try {
        operation = await gatewayRequest(fetcher, `${target}/publish-operations`, config.serviceSecret, {
            method: 'POST', body: JSON.stringify({ releaseId: intent.releaseId,
                idempotencyKey: intent.idempotencyKey, expectedRevision: intent.revision }),
        });
    } catch (cause) {
        if (cause instanceof GatewayRevisionConflict) {
            intent = { ...intent, status: 'failed', failureCode: 'revision_conflict' };
            const failed = { ...site, gatewayPublishIntent: JSON.stringify(intent), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
            await source.saveSite(failed, site.updatedAt);
            throw cause;
        }
        throw cause;
    }
    if (!operation || typeof operation !== 'object' || typeof (operation as { id?: unknown }).id !== 'string' ||
        !['pending', 'ready', 'failed'].includes(String((operation as { status?: unknown }).status))) {
        throw new Error('Gateway returned an invalid publication operation');
    }
    const submittedStatus = (operation as { status: 'pending' | 'ready' | 'failed' }).status;
    // A ready operation is provisional until its authoritative activation is confirmed.
    intent = { ...intent, operationId: (operation as { id: string }).id,
        status: submittedStatus === 'ready' ? 'pending' : submittedStatus };
    const completed = { ...site, gatewayPublishIntent: JSON.stringify(intent), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
    if (!await source.saveSite(completed, site.updatedAt)) throw new Error('CMS site changed while recording Gateway publication');
    if (submittedStatus === 'ready') {
        const confirmed = await readGatewayOperation(source, completed, intent.operationId!, config, fetcher);
        return { ...responseIntent(intent), status: confirmed.status || 'pending' };
    }
    return responseIntent(intent);
}

export function gatewayBound(site: SiteInstallation | null, config: GatewayPublishConfig) {
    try {
        validateConfig(config);
        return !!site && site._id === config.cmsSiteId && (site.workspaceId || 'default') === config.cmsWorkspaceId;
    } catch { return false; }
}

export async function readGatewayOperation(source: GatewayReleaseSource, site: SiteInstallation, operationId: string, config: GatewayPublishConfig,
    fetcher: typeof fetch = fetch) {
    const { base } = validateConfig(config);
    const intent = parseIntent(site);
    if (!intent?.operationId || intent.operationId !== operationId) throw new Error('Gateway publication operation not found');
    const url = `${base.origin}/api/v1/sites/${config.siteId}/publish-operations/${encodeURIComponent(operationId)}`;
    const result = await gatewayRequest(fetcher, url, config.serviceSecret, { method: 'GET' });
    if (!result || typeof result !== 'object' || (result as { id?: unknown }).id !== operationId ||
        (result as { releaseId?: unknown }).releaseId !== intent.releaseId ||
        !['pending', 'ready', 'failed'].includes(String((result as { status?: unknown }).status)) ||
        !Number.isSafeInteger((result as { revision?: unknown }).revision)) {
        throw new Error('Gateway returned an invalid publication operation');
    }
    if ((result as { status: string }).status === 'ready') {
        const state = await reconcileGatewayState(source, site, config, fetcher);
        const revision = (result as { revision: number }).revision;
        if (!state.active || state.active.routeRevision < revision ||
            state.active.routeRevision === revision && state.active.releaseId !== intent.releaseId) {
            throw new Error('Gateway active deployment has not confirmed this publication');
        }
    }
    const updated: GatewayPublishIntent = { ...intent, status: (result as { status: GatewayPublishIntent['status'] }).status,
        failureCode: typeof (result as { failureCode?: unknown }).failureCode === 'string' ? (result as { failureCode: string }).failureCode : undefined };
    if (JSON.stringify(updated) !== JSON.stringify(intent)) {
        const next = { ...site, gatewayPublishIntent: JSON.stringify(updated), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
        await source.saveSite(next, site.updatedAt);
    }
    return { id: operationId, status: updated.status, failureCode: updated.failureCode,
        releaseId: intent.releaseId, revision: (result as { revision?: number }).revision };
}

function sameRecord(a: PublicTemplateRecord, b: PublicTemplateRecord): boolean {
    return a.schemaVersion === b.schemaVersion && a.id === b.id && a.version === b.version &&
        a.manifestChecksum === b.manifestChecksum && a.imageRepository === b.imageRepository &&
        a.imageDigest === b.imageDigest && a.sourceCommit === b.sourceCommit &&
        a.manifestPath === b.manifestPath && a.status === b.status;
}
