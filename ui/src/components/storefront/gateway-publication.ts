/** Keep a publish action stable across a lost response or a page reload. */
export type PublishStatus = 'draft' | 'checking' | 'publishing' | 'snapshot-created' | 'ready' | 'failed' | 'rolled-back' | 'unknown';

export function normalizePublishStatus(status: unknown, operation: 'publish' | 'rollback' = 'publish'): PublishStatus {
    if (operation === 'rollback' && status === 'ready') return 'rolled-back';
    if (status === 'pending') return 'publishing';
    if (status === 'ready') return 'ready';
    if (status === 'failed') return 'failed';
    if (status === 'unknown') return 'unknown';
    return 'draft';
}

export function publicationSuccessMessageKey(bound: boolean, status: string): string {
    return bound && status === 'ready'
        ? 'presets.releasePublished'
        : 'presets.releaseSnapshotCreated';
}

export function createPublicationAction(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: string, makeId: () => string) {
    const key = `bcms:gateway-publish:${scope}`;
    return {
        request(identity = 'publish'): string {
            const saved = storage.getItem(key);
            if (saved && (storage.getItem(`${key}:action`) || 'publish') === identity) return saved;
            const created = makeId();
            storage.setItem(key, created);
            storage.setItem(`${key}:action`, identity);
            return created;
        },
        complete(status: string, requestKey?: string): void {
            if ((status === 'ready' || status === 'failed') && requestKey && storage.getItem(key) === requestKey) { storage.removeItem(key); storage.removeItem(`${key}:action`); }
        },
    };
}
