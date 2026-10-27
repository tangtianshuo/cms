import { getPreset, type PresetManifest } from './catalog';
import type { SiteInstallation } from './site-model';

export function resolveInstalledPreset(site: SiteInstallation): PresetManifest {
    if (site.publishedTemplateRecord != null && site.presetManifestSnapshot == null) {
        throw new Error('Installed public template snapshot is missing');
    }
    if (site.presetManifestSnapshot != null) {
        let preset: unknown;
        try { preset = JSON.parse(site.presetManifestSnapshot); } catch { throw new Error('Installed template snapshot is invalid'); }
        if (!preset || typeof preset !== 'object' || (preset as PresetManifest).id !== site.presetId ||
            (preset as PresetManifest).version !== site.presetVersion || !Array.isArray((preset as PresetManifest).models) ||
            !Array.isArray((preset as PresetManifest).pages)) throw new Error('Installed template snapshot does not match the site');
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
        }
        return preset as PresetManifest;
    }
    const builtin = getPreset(site.presetId, site.presetVersion);
    if (!builtin) throw new Error('Theme version is unavailable');
    return builtin;
}
