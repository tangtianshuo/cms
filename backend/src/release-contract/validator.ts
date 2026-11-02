import { createHash } from 'node:crypto';
import type { ContractSnapshotV1 } from './snapshot';

const digest = /^sha256:[a-f0-9]{64}$/;
const safeAssetPath = (value: unknown): value is string => typeof value === 'string' && value.startsWith('media/') && !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..');

export function validateReleaseContract(value: unknown): asserts value is ContractSnapshotV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release contract is invalid');
    const snapshot = value as Record<string, unknown>;
    if (snapshot.contractVersion !== 1 || snapshot.schemaVersion !== 1 || typeof snapshot.workspaceId !== 'string' || typeof snapshot.siteId !== 'string' || typeof snapshot.language !== 'string' || !Array.isArray(snapshot.pages) || !Array.isArray(snapshot.assets)) throw new Error('Release contract identity is invalid');
    const template = snapshot.template as Record<string, unknown> | undefined;
    if (!template || typeof template.id !== 'string' || typeof template.version !== 'string') throw new Error('Release template identity is invalid');
    const identities = (snapshot.pages as Array<Record<string, unknown>>).map((page) => (page.content as Record<string, unknown>)?.preset as Record<string, unknown> | undefined);
    if (identities.some((item) => !item || item.id !== template.id || item.version !== template.version)) throw new Error('Release pages have mixed template identity');
    for (const asset of snapshot.assets as Array<Record<string, unknown>>) {
        if (!safeAssetPath(asset.path) || !digest.test(String(asset.checksum)) || typeof asset.mimeType !== 'string') throw new Error('Release asset is invalid');
        if (asset.contentBase64 !== undefined) {
            let bytes: Buffer;
            try { bytes = Buffer.from(String(asset.contentBase64), 'base64'); } catch { throw new Error('Release asset content is invalid'); }
            const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
            if (actual !== asset.checksum) throw new Error('Release asset checksum mismatch');
        }
    }
}
