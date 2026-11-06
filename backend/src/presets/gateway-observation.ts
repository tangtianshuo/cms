import { createHash } from 'node:crypto';
import { ownerWorkspace } from '../workspaces/context';
import { isGatewayUnavailable, type GatewayPublishConfig } from './gateway-client';
import { cmsSnapshot, gatewayStateTemplateRecord, readGatewayState } from './gateway-state';
import type { GatewayPublishIntent, GatewayReleaseSource } from './gateway-publish';
import { canonicalJson, type PublicTemplateRecord } from './registry';
import type { ReleaseSnapshot } from './releases';

type ObservationSource = Pick<GatewayReleaseSource, 'findSite' | 'findRelease'>;
type Observation = { schemaVersion: 1; status: 'blocked' | 'unavailable'; reason: string } | {
    schemaVersion: 1; status: 'ready'; cmsWorkspaceId: string; cmsSiteId: string; siteUrl: string;
    releaseId: string; activeRevision: number; template: PublicTemplateRecord; snapshotChecksum: string;
    publishedHome: { projection: 'home-hero-title'; contentChecksum: string; markerChecksum: string | null; containsMarker: boolean };
};
const checksum = (value: string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const blocked = (reason: string): Observation => ({ schemaVersion: 1, status: 'blocked', reason });

// Both selected templates render the enabled hero title, with layout taking precedence.
// Restrict the acceptance marker to that visible heading, never metadata or other pages.
function homeHeadline(snapshot: ReleaseSnapshot, template: PublicTemplateRecord): string {
    const homes = snapshot.pages.filter(page => page.path === '/');
    if (homes.length !== 1) throw new Error('Immutable homepage is missing or ambiguous');
    const page = homes[0], content = page.content;
    if (content.kind !== 'preset-page' || content.view !== 'home' || content.preset.id !== template.id || content.preset.version !== template.version || !content.sections.includes('hero')) return '';
    const layout = page.layoutDocument ?? content.layoutDocument;
    const sections = layout ? layout.root.map(node => ({ type: node.type, enabled: node.enabled, data: node.props })) : content.sectionConfigs;
    let title: unknown = content.preset.demo.hero.title;
    if (sections) {
        const heroes = sections.filter(section => section.type === 'hero' && section.enabled);
        if (heroes.length !== 1) return '';
        if (heroes[0].data.title !== undefined) title = heroes[0].data.title;
    }
    return typeof title === 'string' ? title : '';
}

/** Acceptance observation has read capabilities only. Normal recovery remains a separate flow. */
export async function observeGatewayPublication(source: ObservationSource, config: GatewayPublishConfig,
    marker?: string, fetcher: typeof fetch = fetch): Promise<Observation> {
    if (marker !== undefined && (typeof marker !== 'string' || !marker.length || marker.length > 256)) return blocked('invalid_marker');
    const site = await source.findSite();
    if (!site || site.status !== 'ready' || site._id !== config.cmsSiteId || ownerWorkspace(site) !== config.cmsWorkspaceId) return blocked('site_binding_mismatch');
    let intent: GatewayPublishIntent;
    try { intent = JSON.parse(site.gatewayPublishIntent || 'null'); }
    catch { return blocked('publication_incomplete'); }
    if (!intent || intent.status !== 'ready' || !intent.operationId || !intent.releaseId || !Number.isSafeInteger(intent.revision)) return blocked('publication_incomplete');
    try {
        const state = await readGatewayState(site, config, fetcher), active = state.active;
        if (!active || active.releaseId !== intent.releaseId || site.gatewayCurrentReleaseId !== active.releaseId ||
            site.gatewayActiveRevision !== active.routeRevision || active.routeRevision <= intent.revision || !site.gatewayPublishedReleaseIds?.includes(active.releaseId)) return blocked('publication_mismatch');
        const template = gatewayStateTemplateRecord(active.metadata, active.imageDigest);
        const release = await source.findRelease(active.releaseId);
        if (!release || release._id !== active.releaseId || release.target !== 'gateway' || release.siteId !== site._id ||
            ownerWorkspace(release) !== ownerWorkspace(site) || !release.templateRecord || !release.artifactPayload ||
            canonicalJson(JSON.parse(release.templateRecord)) !== canonicalJson(template) || canonicalJson(intent.record) !== canonicalJson(template)) return blocked('immutable_release_mismatch');
        const frozenBytes = Buffer.from(intent.snapshot, 'base64').toString('utf8');
        if (checksum(frozenBytes) !== intent.checksum || canonicalJson(JSON.parse(frozenBytes)) !== canonicalJson(active.snapshot) ||
            canonicalJson(JSON.parse(release.artifactPayload)) !== canonicalJson(active.snapshot) ||
            canonicalJson(JSON.parse(release.payload)) !== canonicalJson(cmsSnapshot(active.snapshot, site))) return blocked('immutable_snapshot_mismatch');
        const title = homeHeadline(active.snapshot, template);
        return { schemaVersion: 1, status: 'ready', cmsWorkspaceId: ownerWorkspace(site), cmsSiteId: site._id, siteUrl: config.siteUrl,
            releaseId: active.releaseId, activeRevision: active.routeRevision, template, snapshotChecksum: intent.checksum,
            publishedHome: { projection: 'home-hero-title', contentChecksum: checksum(title), markerChecksum: marker === undefined ? null : checksum(marker),
                containsMarker: marker !== undefined && title.includes(marker) } };
    } catch (cause) {
        return isGatewayUnavailable(cause) ? { schemaVersion: 1, status: 'unavailable', reason: 'gateway_unavailable' } : blocked('publication_mismatch');
    }
}
