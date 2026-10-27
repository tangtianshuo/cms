import { createHash, randomUUID } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { buildRelease, type ReleaseSnapshot, type ReleaseSource } from './releases';
import type { PublicTemplateRecord } from './registry';
import type { SiteInstallation } from './site-model';

export interface GatewayPublishConfig {
    gatewayBaseUrl: string;
    workspaceId: string;
    siteId: string;
    serviceSecret: string;
    cmsWorkspaceId: string;
    cmsSiteId: string;
    siteUrl: string;
}

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
}

export interface GatewayReleaseSource extends ReleaseSource {
    saveSite(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
}

export class GatewayRevisionConflict extends Error {}

export function gatewayPublishConfig(env: NodeJS.ProcessEnv = process.env): GatewayPublishConfig {
    return {
        gatewayBaseUrl: env.GATEWAY_BASE_URL || '', workspaceId: env.GATEWAY_WORKSPACE_ID || '',
        siteId: env.GATEWAY_SITE_ID || '', serviceSecret: env.CMS_SERVICE_SECRET || '',
        cmsWorkspaceId: env.GATEWAY_CMS_WORKSPACE_ID || '', cmsSiteId: env.GATEWAY_CMS_SITE_ID || '',
        siteUrl: env.GATEWAY_PUBLIC_SITE_URL || '',
    };
}

function validateConfig(config: GatewayPublishConfig) {
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

function publicRecord(site: SiteInstallation): PublicTemplateRecord {
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
            !intent.record || intent.record.id !== site.presetId || intent.record.version !== site.presetVersion) throw new Error();
        return intent;
    } catch { throw new Error('Stored Gateway publication intent is invalid'); }
}

async function gatewayRequest(fetcher: typeof fetch, url: string, secret: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...init.headers } });
    if (response.status === 409) throw new GatewayRevisionConflict('Gateway rejected a concurrent change; refresh the site state and retry');
    if (!response.ok) throw new Error(`Gateway request failed (${response.status})`);
    const body = await response.json();
    return body;
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

async function currentRevision(fetcher: typeof fetch, url: string, secret: string): Promise<number> {
    const result = await gatewayRequest(fetcher, url, secret, { method: 'GET' });
    if (!result || typeof result !== 'object' || !Number.isSafeInteger((result as { revision?: number }).revision) ||
        (result as { revision: number }).revision < 0) throw new Error('Gateway returned an invalid site revision');
    return (result as { revision: number }).revision;
}

function responseIntent(intent: GatewayPublishIntent) {
    return { releaseId: intent.releaseId, operationId: intent.operationId || '', status: intent.status || 'pending' };
}

export async function publishGatewayRelease(
    source: GatewayReleaseSource, _actorId: string, expectedReleaseId: string, requestKey: string,
    config: GatewayPublishConfig, fetcher: typeof fetch = fetch, build: typeof buildRelease = buildRelease,
) {
    const { base } = validateConfig(config);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
        throw new Error('A stable requestKey UUID is required');
    }
    const site = await source.findSite();
    if (!site || site.status !== 'ready') throw new Error('Site is not ready');
    if (site._id !== config.cmsSiteId || (site.workspaceId || 'default') !== config.cmsWorkspaceId) throw new Error('This CMS site is not bound to the configured Gateway target');
    if ((site.currentReleaseId || '') !== expectedReleaseId) throw new Error('Published site changed; refresh before continuing');
    const previous = site.currentReleaseId ? await source.findRelease(site.currentReleaseId) : null;
    if (previous && (previous.siteId !== site._id || ownerWorkspace(previous) !== ownerWorkspace(site))) throw new Error('Release belongs to another site');
    const prior = previous ? JSON.parse(previous.payload) as ReleaseSnapshot : undefined;
    if (prior && (prior.siteId !== site._id || ownerWorkspace(prior) !== ownerWorkspace(site))) throw new Error('Release snapshot belongs to another site');
    const record = publicRecord(site);
    const target = `${base.origin}/api/v1/sites/${config.siteId}`;
    const pinIdentity = site.gatewayPinnedTemplateRecord ? JSON.parse(site.gatewayPinnedTemplateRecord) : null;
    if (!identityMatches(pinIdentity, record)) {
        const pin = await gatewayRequest(fetcher, `${target}/template-pin`, config.serviceSecret, {
            method: 'PUT', body: JSON.stringify({ templateId: record.id, templateVersion: record.version }),
        });
        if (!identityMatches(pin, record)) throw new Error('Gateway template pin does not match the approved public template record');
        const pinnedSite = { ...site, gatewayPinnedTemplateRecord: JSON.stringify(pin), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
        if (!await source.saveSite(pinnedSite, site.updatedAt)) throw new Error('CMS site changed while binding its Gateway template');
        site.gatewayPinnedTemplateRecord = pinnedSite.gatewayPinnedTemplateRecord;
        site.updatedAt = pinnedSite.updatedAt;
    }
    let intent = parseIntent(site);
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
    if (intent?.status === 'pending' && intent.requestKey !== requestKey) throw new Error('A Gateway publication is still pending');
    if (!intent || intent.requestKey !== requestKey || intent.expectedReleaseId !== expectedReleaseId) {
        const revision = await currentRevision(fetcher, target, config.serviceSecret);
        const snapshot = build({ ...await source.loadContent(site), site, previous: prior });
        const bytes = Buffer.from(JSON.stringify({ ...snapshot, workspaceId: config.workspaceId, siteId: config.siteId }), 'utf8');
        intent = {
            requestKey, expectedReleaseId, releaseId: randomUUID(), idempotencyKey: requestKey,
            revision, snapshot: bytes.toString('base64'),
            checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, record,
        };
        const prepared = { ...site, gatewayPublishIntent: JSON.stringify(intent), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
        if (!await source.saveSite(prepared, site.updatedAt)) throw new Error('CMS site changed while preparing Gateway publication');
        Object.assign(site, prepared);
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
    intent = { ...intent, operationId: (operation as { id: string }).id,
        status: (operation as { status: 'pending' | 'ready' | 'failed' }).status };
    const completed = { ...site, gatewayPublishIntent: JSON.stringify(intent), updatedAt: Math.max(Date.now(), site.updatedAt + 1) };
    if (!await source.saveSite(completed, site.updatedAt)) throw new Error('CMS site changed while recording Gateway publication');
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
