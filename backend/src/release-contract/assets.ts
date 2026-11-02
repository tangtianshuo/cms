import { createHash } from 'node:crypto';
import type { Media } from '../media/models/main';
import { MediaStorage } from '../media/storage';
import type { ReleaseSnapshot } from '../presets/releases';
import type { ContractAsset } from './snapshot';

export class ReleaseAssetError extends Error {
    readonly code = 'release-asset-unavailable';
}

const maxEmbeddedAssetBytes = 6 * 1024 * 1024;

function safeSegment(value: string): string {
    const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || 'asset';
}

function assetPath(media: Media): string {
    const extension = media.mimetype.split('/')[1]?.split(/[+_-]/)[0] || 'bin';
    return `media/${safeSegment(media._id)}/original.${safeSegment(extension)}`;
}

/** Build an immutable manifest for media referenced by a release snapshot. */
export async function collectReleaseAssets(snapshot: ReleaseSnapshot, media: Media[]): Promise<ContractAsset[]> {
    const ids = new Set(snapshot.mediaIds || []);
    const selected = media.filter(item => ids.has(item._id) && item.type !== 'DIR');
    const assets: ContractAsset[] = [];
    for (const item of selected.sort((a, b) => a._id.localeCompare(b._id))) {
        const bytes = await MediaStorage.read(item);
        if (!bytes) throw new ReleaseAssetError(`Media ${item._id} is unavailable`);
        if (bytes.byteLength > maxEmbeddedAssetBytes) {
            throw new ReleaseAssetError(`Media ${item._id} exceeds the immutable release asset limit`);
        }
        assets.push({
            path: assetPath(item),
            checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            mimeType: item.mimetype,
            mediaId: item._id,
            sourcePath: MediaStorage.resolveCloudPath(item),
            contentBase64: bytes.toString('base64'),
        });
    }
    return assets;
}
