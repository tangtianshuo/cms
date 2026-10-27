/** Keep a publish action stable across a lost response or a page reload. */
export function createPublicationAction(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: string, makeId: () => string) {
    const key = `bcms:gateway-publish:${scope}`;
    return {
        request(): string {
            const saved = storage.getItem(key);
            if (saved) return saved;
            const created = makeId();
            storage.setItem(key, created);
            return created;
        },
        complete(status: string, requestKey?: string): void {
            if ((status === 'ready' || status === 'failed') && requestKey && storage.getItem(key) === requestKey) storage.removeItem(key);
        },
    };
}
