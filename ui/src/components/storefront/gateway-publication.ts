/** Keep a publish action stable across a lost response or a page reload. */
export type PublishStatus = 'draft' | 'checking' | 'publishing' | 'ready' | 'failed' | 'rolled-back';

export function normalizePublishStatus(status: unknown, operation: 'publish' | 'rollback' = 'publish'): PublishStatus {
    if (operation === 'rollback' && status === 'ready') return 'rolled-back';
    if (status === 'pending') return 'publishing';
    if (status === 'ready') return 'ready';
    if (status === 'failed') return 'failed';
    return 'draft';
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
