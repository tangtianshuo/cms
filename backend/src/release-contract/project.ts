import { createHash } from 'node:crypto';
import type { ReleaseSnapshot } from '../presets/releases';
import { toContractSnapshot, type ContractAsset, type ContractSnapshotV1 } from './snapshot';
import { validateReleaseContract } from './validator';

function canonical(value: unknown): string {
    const sort = (item: unknown): unknown => {
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (Array.isArray(item)) return item.map(sort);
        if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, sort((item as Record<string, unknown>)[key])]));
        throw new Error('Release contains a non-JSON value');
    };
    return JSON.stringify(sort(value));
}

export function contractChecksum(snapshot: ContractSnapshotV1): string {
    return `sha256:${createHash('sha256').update(canonical(snapshot), 'utf8').digest('hex')}`;
}

export function projectReleaseSnapshot(snapshot: ReleaseSnapshot, assets: ContractAsset[] = []) {
    const projected = toContractSnapshot(snapshot, assets);
    validateReleaseContract(projected);
    const checksum = contractChecksum(projected);
    return { snapshot: projected, checksum, requestKey: `site:${projected.siteId}:release:${checksum.slice(7, 19)}` };
}
