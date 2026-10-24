import { randomUUID } from 'node:crypto';
import { Config } from '../config';
import { createMongoDBRepository, MongoDBEntrySchema, type MongoDBEntry } from '../_server/modules/mongodb';
import { workspaceId } from '../workspaces/context';
import { withWorkspaceCreation } from '../workspaces/lifecycle';

export interface EntryGroup extends MongoDBEntry {
    name: string;
    siteId?: string;
    revision?: number;
    pendingWrites?: string[];
}
export const defaultEntryGroupId = (id = workspaceId()) => `default:${id}`;
export class EntryGroupConflict extends Error { readonly status = 409; }
export const EntryGroupRepo = createMongoDBRepository<EntryGroup, {
    rename(id: string, name: string): Promise<boolean>;
    ensure(id?: string, siteId?: string, name?: string): Promise<EntryGroup>;
    withWrites<T>(ids: string[], action: () => Promise<T>): Promise<T>;
    removeEmpty(id: string, occupied: () => Promise<boolean>, allowDefault?: boolean): Promise<boolean>;
}>({
    name: 'EntryGroup', collection: `${Config.storageScope}_entry_groups`,
    schema: { ...MongoDBEntrySchema, name: { __type: 'string', __required: true }, siteId: { __type: 'string', __required: false } },
    methods({ mdb, repo, cache }) { return {
        async rename(id, name) { return (await mdb.updateOne({ _id: id }, { $set: { name, updatedAt: Date.now() } })).matchedCount === 1; },
        async ensure(id = defaultEntryGroupId(), siteId, name = 'General') {
            const existing = await repo.findById(id);
            if (existing) return existing;
            try { return await repo.add({ _id: id, workspaceId: workspaceId(), name, siteId, createdAt: Date.now(), updatedAt: Date.now(), revision: 0, pendingWrites: [] }); }
            catch (error) { if ((error as { code?: number }).code !== 11000) throw error; const group = await repo.findById(id); if (!group) throw error; return group; }
        },
        async withWrites(ids, action) {
            return withWorkspaceCreation({ kind: 'entry-group-write', resourceId: ids.join(',') }, async () => {
                const held: Array<{ id: string; permit: string }> = [];
                for (const id of [...new Set(ids)].sort()) {
                    const permit = randomUUID();
                    const result = await mdb.updateOne({ _id: id }, { $inc: { revision: 1 }, $push: { pendingWrites: permit } });
                    if (result.matchedCount !== 1) throw new EntryGroupConflict('Entry group no longer exists');
                    held.push({ id, permit });
                }
                // Failure keeps durable permits; do not clear uncertain writes.
                const result = await action();
                for (const { id, permit } of held) {
                    try { await mdb.updateOne({ _id: id }, { $inc: { revision: 1 }, $pull: { pendingWrites: permit } }); cache.remove(id); }
                    catch (error) { console.error('Entry group acknowledgement deferred', error); }
                }
                return result;
            });
        },
        async removeEmpty(id, occupied, allowDefault = false) {
            if (!allowDefault && id === defaultEntryGroupId()) throw new EntryGroupConflict('Default entry group cannot be deleted');
            const group = await mdb.findOne({ _id: id });
            if (!group) return false;
            if (group.pendingWrites?.length || await occupied()) throw new EntryGroupConflict('Entry group is in use');
            const result = await mdb.deleteOne({ _id: id, ...(group.revision === undefined ? { revision: { $exists: false } } : { revision: group.revision }), pendingWrites: { $not: { $elemMatch: { $exists: true } } } });
            if (result.deletedCount !== 1) throw new EntryGroupConflict('Entry group changed; refresh');
            cache.remove(id); return true;
        },
    }; },
});
