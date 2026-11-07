import assert from 'node:assert/strict';
import test from 'node:test';
import {
    setSiteMutationStore,
    withSiteMutation,
    SiteMutationConflict,
    type SiteMutationStore,
} from './site-mutation';

function memoryStore(): SiteMutationStore {
    const leases = new Map<
        string,
        { token: string; until: number; mode: 'write' | 'migration' }
    >();
    const states = new Map<
        string,
        {
            status: 'idle' | 'publishing' | 'active' | 'failed' | 'rolled-back';
            operationId?: string;
        }
    >();
    return {
        async claimSiteMutation(
            siteId,
            token,
            mode,
            operationId,
            now,
            leaseUntil,
        ) {
            const lease = leases.get(siteId);
            if (lease && lease.until > now) return false;
            if (
                mode === 'write' &&
                states.get(siteId)?.status === 'publishing'
            ) {
                return false;
            }
            if (
                mode === 'migration' &&
                states.get(siteId)?.status === 'publishing' &&
                states.get(siteId)?.operationId !== operationId
            ) {
                return false;
            }
            leases.set(siteId, { token, until: leaseUntil, mode });
            if (mode === 'migration' && operationId) {
                states.set(siteId, {
                    status: 'publishing',
                    operationId,
                });
            }
            return true;
        },
        async releaseSiteMutation(siteId, token) {
            if (leases.get(siteId)?.token !== token) return false;
            leases.delete(siteId);
            return true;
        },
        async renewSiteMutation(siteId, token, leaseUntil) {
            const lease = leases.get(siteId);
            if (lease?.token !== token) return false;
            lease.until = leaseUntil;
            return true;
        },
        async siteMutationState(siteId) {
            return states.get(siteId) || { status: 'idle' as const };
        },
    };
}

test.afterEach(() => setSiteMutationStore(null));

test('serializes normal writes for the same site and isolates other sites', async () => {
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    const first = withSiteMutation('site-a', async () => {
        events.push('a-start');
        await blocked;
        events.push('a-end');
    });
    await new Promise((resolve) => setImmediate(resolve));
    const second = withSiteMutation('site-a', async () => {
        events.push('a-second');
    });
    await withSiteMutation('site-b', async () => {
        events.push('b');
    });
    assert.deepEqual(events, ['a-start', 'b']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['a-start', 'b', 'a-end', 'a-second']);
});

test('persistent publishing state blocks normal writes after the migration lease is released', async () => {
    setSiteMutationStore(memoryStore());
    await withSiteMutation(
        'site-a',
        async () => {
            assert.equal(
                await withSiteMutation('site-a', async () => 'nested'),
                'nested',
            );
        },
        { mode: 'migration', operationId: 'operation-1' },
    );
    await assert.rejects(
        () => withSiteMutation('site-a', async () => undefined),
        SiteMutationConflict,
    );
});

test('nested calls reuse the site lease instead of deadlocking or stealing it', async () => {
    setSiteMutationStore(memoryStore());
    const value = await withSiteMutation('site-a', async () =>
        withSiteMutation('site-a', async () =>
            withSiteMutation('site-a', async () => 7),
        ),
    );
    assert.equal(value, 7);
});

test('a long migration renews its lease before another owner can take over', async () => {
    setSiteMutationStore(memoryStore());
    const events: string[] = [];
    const first = withSiteMutation(
        'site-a',
        async () => {
            events.push('first-start');
            await new Promise((resolve) => setTimeout(resolve, 140));
            events.push('first-end');
        },
        { mode: 'migration', operationId: 'first', leaseMs: 60 },
    );
    await new Promise((resolve) => setTimeout(resolve, 75));
    const second = withSiteMutation(
        'site-a',
        async () => {
            events.push('second-start');
        },
        { mode: 'migration', operationId: 'first', leaseMs: 60 },
    );
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
});

test('a different operation cannot take over a persisted publishing owner', async () => {
    const store = memoryStore();
    setSiteMutationStore(store);
    const now = Date.now();
    assert.equal(
        await store.claimSiteMutation(
            'site-a',
            'token-1',
            'migration',
            'operation-1',
            now,
            now + 10,
        ),
        true,
    );
    assert.equal(await store.releaseSiteMutation('site-a', 'token-1'), true);
    assert.equal(
        await store.claimSiteMutation(
            'site-a',
            'token-2',
            'migration',
            'operation-2',
            now + 100,
            now + 200,
        ),
        false,
    );
    assert.equal(
        await store.claimSiteMutation(
            'site-a',
            'token-3',
            'migration',
            'operation-1',
            now + 100,
            now + 200,
        ),
        true,
    );
});
