import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type SiteMutationMode = 'write' | 'migration';

export interface SiteMutationLeaseOptions {
    mode: SiteMutationMode;
    operationId?: string;
    leaseMs?: number;
}

export interface SiteMutationStore {
    claimSiteMutation(
        siteId: string,
        token: string,
        mode: SiteMutationMode,
        operationId: string | undefined,
        now: number,
        leaseUntil: number,
    ): Promise<boolean>;
    releaseSiteMutation(siteId: string, token: string): Promise<boolean>;
    siteMutationState(siteId: string): Promise<{
        status: 'idle' | 'publishing' | 'active' | 'failed' | 'rolled-back';
        operationId?: string;
    }>;
}

export class SiteMutationConflict extends Error {
    readonly status = 409;

    constructor(message = 'A template upgrade is in progress; retry later') {
        super(message);
        this.name = 'SiteMutationConflict';
    }
}

interface MutationContext {
    siteId: string;
    token: string;
    mode: SiteMutationMode;
}

const context = new AsyncLocalStorage<MutationContext>();
const fallbackLocks = new Map<
    string,
    { token: string; mode: SiteMutationMode; until: number }
>();
let configuredStore: SiteMutationStore | null = null;

export function setSiteMutationStore(store: SiteMutationStore | null): void {
    configuredStore = store;
}

async function claimFallback(
    siteId: string,
    token: string,
    mode: SiteMutationMode,
    now: number,
    leaseUntil: number,
): Promise<boolean> {
    const current = fallbackLocks.get(siteId);
    if (current && current.until > now) return false;
    fallbackLocks.set(siteId, { token, mode, until: leaseUntil });
    return true;
}

/**
 * Serialize normal site writes and migration actions.
 *
 * Production registers a Mongo-backed store on the SiteInstallation repository.
 * Nested calls inherit the same lease so repository-level guards and controller
 * actions can both use the boundary without extending or releasing it twice.
 */
export async function withSiteMutation<T>(
    siteId: string,
    action: () => Promise<T>,
    options: SiteMutationLeaseOptions = { mode: 'write' },
): Promise<T> {
    if (!siteId) throw new TypeError('siteId is required');
    const inherited = context.getStore();
    if (inherited?.siteId === siteId) {
        if (inherited.mode === 'write' && options.mode === 'migration') {
            throw new SiteMutationConflict();
        }
        return action();
    }
    const token = randomUUID();
    const now = Date.now();
    const leaseUntil = now + (options.leaseMs ?? 120_000);
    const store = configuredStore;
    let claimed = false;
    const waitUntil = Date.now() + 5_000;
    while (!claimed) {
        claimed = store
            ? await store.claimSiteMutation(
                  siteId,
                  token,
                  options.mode,
                  options.operationId,
                  Date.now(),
                  leaseUntil,
              )
            : await claimFallback(
                  siteId,
                  token,
                  options.mode,
                  Date.now(),
                  leaseUntil,
              );
        if (claimed) break;
        if (
            options.mode === 'write' &&
            store &&
            (await store.siteMutationState(siteId)).status === 'publishing'
        ) {
            throw new SiteMutationConflict();
        }
        if (Date.now() >= waitUntil) throw new SiteMutationConflict();
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    try {
        return await context.run({ siteId, token, mode: options.mode }, action);
    } finally {
        if (store) await store.releaseSiteMutation(siteId, token);
        else {
            const current = fallbackLocks.get(siteId);
            if (current?.token === token) fallbackLocks.delete(siteId);
        }
    }
}

export async function siteMutationState(siteId: string) {
    return configuredStore
        ? configuredStore.siteMutationState(siteId)
        : { status: 'idle' as const };
}
