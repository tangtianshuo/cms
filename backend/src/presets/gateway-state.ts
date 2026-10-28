import { createHash } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { canonicalJson, type PublicTemplateRecord } from './registry';
import { gatewayRequest, validateConfig, type GatewayPublishConfig } from './gateway-client';
import type { GatewayReleaseSource } from './gateway-publish';
import type { ReleaseRecord, ReleaseSnapshot } from './releases';
import type { SiteInstallation } from './site-model';

export { snapshotFingerprint } from './release-fingerprint';

export function cmsSnapshot(snapshot: ReleaseSnapshot, site: SiteInstallation): ReleaseSnapshot {
    return { ...snapshot, workspaceId: ownerWorkspace(site), siteId: site._id };
}

/** Idempotent immutable write. The repository's prepareWrite pins all CMS assets. */
export async function retainGatewaySnapshot(source: GatewayReleaseSource, record: ReleaseRecord): Promise<void> {
    const matches = (existing: ReleaseRecord) => existing.target === 'gateway' && existing.siteId === record.siteId &&
        ownerWorkspace(existing) === ownerWorkspace(record) && canonicalJson(JSON.parse(existing.payload)) === canonicalJson(JSON.parse(record.payload)) &&
        typeof existing.templateRecord === 'string' && typeof record.templateRecord === 'string' &&
        canonicalJson(JSON.parse(existing.templateRecord)) === canonicalJson(JSON.parse(record.templateRecord));
    const existing = await source.findRelease(record._id);
    if (existing) {
        if (!matches(existing)) throw new Error('Gateway Release identity conflicts with stored content');
        return;
    }
    try { await source.insertRelease(record); }
    catch (cause) {
        const concurrent = await source.findRelease(record._id);
        if (!concurrent || !matches(concurrent)) throw cause;
    }
}

export interface GatewayState {
    revision: number;
    active: null | { releaseId: string; imageDigest: string; routeRevision: number;
        metadata: Record<string, unknown>; snapshot: ReleaseSnapshot; createdAt: string };
}

function templateRecord(metadata: Record<string, unknown>, imageDigest: string): PublicTemplateRecord {
    const { templateId: id, templateVersion: version, manifestChecksum, imageRepository, sourceCommit } = metadata;
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
        typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) ||
        typeof manifestChecksum !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(manifestChecksum) ||
        !/^sha256:[a-f0-9]{64}$/.test(imageDigest) || metadata.imageDigest !== imageDigest ||
        imageRepository !== `ghcr.io/tangtianshuo/independent-website-templates/${id}` ||
        typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
        throw new Error('Gateway active template identity is invalid');
    }
    return { schemaVersion: 1, id, version, manifestChecksum, imageRepository, imageDigest, sourceCommit,
        manifestPath: `templates/${id}/${version}/template.json`, status: 'available' };
}

/** Project only the authoritative active tuple; operation.ready alone grants no public media access. */
export async function reconcileGatewayState(source: GatewayReleaseSource, site: SiteInstallation,
    config: GatewayPublishConfig, fetcher: typeof fetch = fetch): Promise<GatewayState> {
    const { base } = validateConfig(config);
    if (site._id !== config.cmsSiteId || ownerWorkspace(site) !== config.cmsWorkspaceId) throw new Error('Gateway site binding mismatch');
    const value = await gatewayRequest(fetcher, `${base.origin}/api/v1/sites/${config.siteId}/publication-state`, config.serviceSecret) as GatewayState;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.active === undefined) throw new Error('Gateway returned invalid publication state');
    const active = value.active;
    if (!active) {
        if (site.gatewayCurrentReleaseId) throw new Error('Gateway active deployment is missing; publication state requires reconciliation');
        return value;
    }
    if (typeof active.releaseId !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(active.releaseId) ||
        !Number.isSafeInteger(active.routeRevision) || active.routeRevision < 1 || active.routeRevision > value.revision ||
        !Number.isFinite(Date.parse(active.createdAt)) || !active.metadata || !active.snapshot ||
        active.snapshot.schemaVersion !== 1 || active.snapshot.workspaceId !== config.workspaceId || active.snapshot.siteId !== config.siteId ||
        !Array.isArray(active.snapshot.pages) || !Array.isArray(active.snapshot.navigation) || !Array.isArray(active.snapshot.redirects)) {
        throw new Error('Gateway returned invalid active deployment');
    }
    const record = templateRecord(active.metadata, active.imageDigest);
    let intent: { releaseId?: string; actorId?: string; operation?: 'publish' | 'rollback'; expectedReleaseId?: string } = {};
    try { intent = JSON.parse(site.gatewayPublishIntent || '{}'); } catch { /* active state can recover a damaged legacy intent */ }
    const existing = await source.findRelease(active.releaseId);
    const now = Date.now();
    await retainGatewaySnapshot(source, { _id: active.releaseId, siteId: site._id, workspaceId: ownerWorkspace(site),
        createdAt: Date.parse(active.createdAt), updatedAt: now,
        createdBy: intent.releaseId === active.releaseId ? intent.actorId || 'legacy-gateway' : 'gateway-reconciliation',
        previousReleaseId: intent.releaseId === active.releaseId ? intent.expectedReleaseId || '' : site.gatewayCurrentReleaseId || '',
        payload: JSON.stringify(cmsSnapshot(active.snapshot, site)), target: 'gateway', templateRecord: JSON.stringify(record) });
    if (!await source.projectGatewayRelease(site, active.releaseId, active.routeRevision)) {
        throw new Error('A newer Gateway deployment was already recorded; refresh');
    }
    site.gatewayCurrentReleaseId = active.releaseId;
    site.gatewayActiveRevision = active.routeRevision;
    site.gatewayPublishedReleaseIds = [...new Set([...(site.gatewayPublishedReleaseIds || []), active.releaseId])];
    // Deterministic IDs let reads and background recovery safely repeat this projection.
    const auditId = createHash('sha256').update(`gateway:${site._id}:${active.releaseId}:${active.routeRevision}`).digest('hex');
    await source.audit({ _id: auditId, workspaceId: ownerWorkspace(site), siteId: site._id, createdAt: now, updatedAt: now,
        actorId: existing?.createdBy || (intent.releaseId === active.releaseId ? intent.actorId || 'legacy-gateway' : 'gateway-reconciliation'),
        operation: intent.releaseId === active.releaseId ? intent.operation || 'publish' : 'publish', releaseId: active.releaseId, error: '' });
    return value;
}
