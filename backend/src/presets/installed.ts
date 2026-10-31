import { getPreset, type PresetManifest } from './catalog';
import type { SiteInstallation } from './site-model';
import { createHash } from 'node:crypto';
import { canonicalJson, normalizePublicManifest } from './registry';

export function resolveInstalledPreset(site: SiteInstallation): PresetManifest {
    if (site.publishedTemplateRecord != null && site.presetManifestSnapshot == null) {
        throw new Error('Installed public template snapshot is missing');
    }
    if (site.presetManifestSnapshot != null) {
        let snapshot: unknown;
        try { snapshot = JSON.parse(site.presetManifestSnapshot); } catch { throw new Error('Installed template snapshot is invalid'); }
        if (!snapshot || typeof snapshot !== 'object') throw new Error('Installed template snapshot does not match the site');
        let preset: unknown = snapshot;
        if (site.publishedTemplateRecord != null) {
            let record: unknown;
            try { record = JSON.parse(site.publishedTemplateRecord); } catch { throw new Error('Installed public template record is invalid'); }
            if (!record || typeof record !== 'object' || (record as { id?: unknown }).id !== site.presetId ||
                (record as { version?: unknown }).version !== site.presetVersion ||
                (record as { schemaVersion?: unknown }).schemaVersion !== 1 || (record as { status?: unknown }).status !== 'available' ||
                typeof (record as { manifestChecksum?: unknown }).manifestChecksum !== 'string' ||
                !/^sha256:[a-f0-9]{64}$/.test((record as { manifestChecksum: string }).manifestChecksum) ||
                (record as { imageRepository?: unknown }).imageRepository !== `ghcr.io/tangtianshuo/independent-website-templates/${site.presetId}` ||
                typeof (record as { imageDigest?: unknown }).imageDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test((record as { imageDigest: string }).imageDigest) ||
                typeof (record as { sourceCommit?: unknown }).sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test((record as { sourceCommit: string }).sourceCommit) ||
                (record as { manifestPath?: unknown }).manifestPath !== `templates/${site.presetId}/${site.presetVersion}/template.json`) {
                throw new Error('Installed public template record does not match the site');
            }
            const checksum = `sha256:${createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex')}`;
            if (checksum !== (record as { manifestChecksum: string }).manifestChecksum) {
                throw new Error('Installed public template snapshot checksum does not match the record');
            }
            const rawPublic = 'compatibility' in (snapshot as Record<string, unknown>) &&
                'presentation' in (snapshot as Record<string, unknown>);
            if (rawPublic) {
                try { preset = normalizePublicManifest(snapshot, record as any); }
                catch { throw new Error('Installed public template snapshot has an invalid public shape'); }
            }
        }
        if (!preset || typeof preset !== 'object' || (preset as PresetManifest).id !== site.presetId ||
            (preset as PresetManifest).version !== site.presetVersion || !Array.isArray((preset as PresetManifest).models) ||
            !Array.isArray((preset as PresetManifest).pages)) throw new Error('Installed template snapshot does not match the site');
        return preset as PresetManifest;
    }
    const builtin = getPreset(site.presetId, site.presetVersion);
    if (!builtin) throw new Error('Theme version is unavailable');
    return builtin;
}
