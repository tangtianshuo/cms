import '../repo';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMongoDBRepository } from '../_server/modules/mongodb/repository';
test('repository CAS rejects stale edits before preparation and enforces database write predicate', async () => {
    let stored = { _id: 'entry', createdAt: 1, updatedAt: 2, value: 'current' };
    let prepared = 0;
    let simulateRace = false;
    const raw = { async findOne() { return { ...stored }; }, async updateOne(query: any, change: any) {
        if (simulateRace) stored = { ...stored, updatedAt: 4, value: 'concurrent' };
        if (query.updatedAt !== undefined && query.updatedAt !== stored.updatedAt) return { matchedCount: 0 };
        stored = { ...stored, ...change.$set }; return { matchedCount: 1 };
    } };
    const repo = createMongoDBRepository<typeof stored>({ name: 'CasTest', collection: 'test', schema: {}, workspaceScoped: false,
        async prepareWrite() { prepared++; } });
    await new Promise<void>((resolve, reject) => repo.init().initialize({ fastify: { mongo: { db: { collection: () => raw } } }, next: (error?: Error) => error ? reject(error) : resolve() } as never));
    await assert.rejects(() => repo.update({ ...stored, value: 'stale' }, false, 1), /changed/);
    assert.equal(prepared, 0);
    assert.equal(stored.value, 'current');
    simulateRace = true;
    await assert.rejects(() => repo.update({ ...stored, value: 'racing' }, false, 2), /changed/);
    assert.equal(stored.value, 'concurrent');
    simulateRace = false;
    await repo.update({ ...stored, value: 'saved' }, false, 4);
    assert.equal(stored.value, 'saved');
    assert.equal(repo.cache.findById('entry')?.value, 'saved');
});
