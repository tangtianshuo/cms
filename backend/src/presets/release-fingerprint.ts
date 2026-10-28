import { createHash } from 'node:crypto';
import { canonicalJson, type PublicTemplateRecord } from './registry';
import type { ReleaseSnapshot } from './releases';

export function snapshotFingerprint(snapshot: ReleaseSnapshot, template?: PublicTemplateRecord): string {
    return createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify({ snapshot, ...(template ? { template } : {}) })))).digest('hex');
}
