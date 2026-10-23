import { createMongoDBRepository, type MongoDBEntry, MongoDBEntrySchema } from '../_server/modules/mongodb';
import { Config } from '../config';
import type { WorkspaceRole } from './context';
export interface Workspace extends MongoDBEntry { name: string; members: Array<{ userId: string; role: WorkspaceRole }> }
export const WorkspaceRepo = createMongoDBRepository<Workspace, {
    fresh(id: string): Promise<Workspace | null>;
    list(userId: string, elevated: boolean): Promise<Workspace[]>;
    rename(id: string, name: string): Promise<void>;
    member(id: string, userId: string, role: WorkspaceRole | null): Promise<void>;
}>({ name: 'Workspace', collection: `${Config.storageScope}_workspaces`, schema: { ...MongoDBEntrySchema,
    name: { __type: 'string', __required: true }, members: { __type: 'array', __required: true, __child: { __type: 'object', __content: {
        userId: { __type: 'string', __required: true }, role: { __type: 'string', __required: true },
    } } },
}, async beforeIndexes(mdb) {
    await mdb.updateOne({ _id: 'default' }, { $setOnInsert: { _id: 'default', name: 'Default workspace', members: [], createdAt: Date.now(), updatedAt: Date.now() } }, { upsert: true });
}, methods({ mdb, cache }) { return {
    fresh: (id) => mdb.findOne({ _id: id }),
    list: (userId, elevated) => mdb.find(elevated ? {} : { $or: [{ _id: 'default' }, { 'members.userId': userId }] }).toArray(),
    async rename(id, name) { await mdb.updateOne({ _id: id }, { $set: { name, updatedAt: Date.now() } }); cache.remove(id); },
    async member(id, userId, role) {
        // One atomic pipeline avoids dropped concurrent membership updates.
        await mdb.updateOne({ _id: id }, [{ $set: { updatedAt: Date.now(), members: { $concatArrays: [
            { $filter: { input: '$members', as: 'member', cond: { $ne: ['$$member.userId', { $literal: userId }] } } },
            { $literal: role ? [{ userId, role }] : [] },
        ] } } }]); cache.remove(id);
    },
}; } });
