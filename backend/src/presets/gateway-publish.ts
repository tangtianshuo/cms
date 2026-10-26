import { createHash, randomUUID } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { buildRelease, type ReleaseSnapshot, type ReleaseSource } from './releases';

export interface GatewayPublishConfig {
    gatewayBaseUrl: string;
    workspaceId: string;
    siteId: string;
    serviceSecret: string;
    manifestChecksum: string;
    imageDigest: string;
    expectedRevision: string | number;
}

export class GatewayRevisionConflict extends Error {}

export function gatewayPublishConfig(env: NodeJS.ProcessEnv = process.env): GatewayPublishConfig {
    return {
        gatewayBaseUrl: env.GATEWAY_BASE_URL || '', workspaceId: env.GATEWAY_WORKSPACE_ID || '',
        siteId: env.GATEWAY_SITE_ID || '', serviceSecret: env.CMS_SERVICE_SECRET || '',
        manifestChecksum: env.GATEWAY_MANIFEST_CHECKSUM || '', imageDigest: env.GATEWAY_IMAGE_DIGEST || '',
        expectedRevision: env.GATEWAY_EXPECTED_REVISION || '',
    };
}

export async function publishGatewayRelease(source: ReleaseSource, _actorId: string, expectedReleaseId: string,
    config: GatewayPublishConfig, fetcher: typeof fetch = fetch, build: typeof buildRelease = buildRelease) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const checksum = /^sha256:[a-f0-9]{64}$/;
    for (const key of ['workspaceId', 'siteId'] as const) {
        if (!uuid.test(config[key])) throw new Error(`Gateway ${key} must be a UUID`);
    }
    for (const key of ['manifestChecksum', 'imageDigest'] as const) {
        if (!checksum.test(config[key])) throw new Error(`Gateway ${key} must be a sha256 digest`);
    }
    if (!config.serviceSecret.trim()) throw new Error('CMS_SERVICE_SECRET is required');
    const revision = String(config.expectedRevision);
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) {
        throw new Error('GATEWAY_EXPECTED_REVISION must be a non-negative safe integer');
    }
    let base: URL;
    try { base = new URL(config.gatewayBaseUrl); }
    catch { throw new Error('Invalid GATEWAY_BASE_URL'); }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
        !(base.protocol === 'https:' || base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
        throw new Error('Gateway base URL must be HTTPS or loopback HTTP without path or credentials');
    }
    const site = await source.findSite();
    if (!site || site.status !== 'ready') throw new Error('Site is not ready');
    if ((site.currentReleaseId || '') !== expectedReleaseId) throw new Error('Published site changed; refresh before continuing');
    const previous = site.currentReleaseId ? await source.findRelease(site.currentReleaseId) : null;
    if (previous && (previous.siteId !== site._id || ownerWorkspace(previous) !== ownerWorkspace(site))) throw new Error('Release belongs to another site');
    const prior = previous ? JSON.parse(previous.payload) as ReleaseSnapshot : undefined;
    if (prior && (prior.siteId !== site._id || ownerWorkspace(prior) !== ownerWorkspace(site))) throw new Error('Release snapshot belongs to another site');
    const snapshot = build({ ...await source.loadContent(site), site, previous: prior });
    const bytes = Buffer.from(JSON.stringify({ ...snapshot, workspaceId: config.workspaceId, siteId: config.siteId }), 'utf8');
    const releaseId = randomUUID();
    const endpoint = `${base.origin}/api/v1/sites/${config.siteId}`;
    const headers = { Authorization: `Bearer ${config.serviceSecret}`, 'Content-Type': 'application/json' };
    async function request(url: string, init?: RequestInit): Promise<unknown> {
        const response = await fetcher(url, { ...init, headers: { ...headers, ...init?.headers } });
        if (response.status === 409) throw new GatewayRevisionConflict('Gateway revision conflict; update GATEWAY_EXPECTED_REVISION before retrying');
        if (!response.ok) throw new Error(`Gateway request failed (${response.status})`);
        return response.json();
    }
    await request(`${endpoint}/releases`, { method: 'POST', body: JSON.stringify({
        siteId: config.siteId, releaseId, checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        metadata: { templateId: 'aeroframe', templateVersion: '1.0.0',
            manifestChecksum: config.manifestChecksum, imageDigest: config.imageDigest },
        snapshot: bytes.toString('base64'),
    }) });
    const operation = await request(`${endpoint}/publish-operations`, {
        method: 'POST', body: JSON.stringify({ releaseId, idempotencyKey: releaseId, expectedRevision: Number(revision) }),
    });
    if (!operation || typeof operation !== 'object' || !('id' in operation) || typeof operation.id !== 'string' || !operation.id ||
        !('status' in operation) || !['pending', 'ready', 'failed'].includes(String(operation.status))) {
        throw new Error('Gateway returned invalid publication operation');
    }
    return { releaseId, operationId: operation.id, status: operation.status as 'pending' | 'ready' | 'failed' };
}
