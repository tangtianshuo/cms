import {
    createMongoDBRepository,
    type MongoDBEntry,
    MongoDBEntrySchema,
} from '../_server/modules/mongodb';
import { Config } from '../config';
import { DEFAULT_WORKSPACE, type WorkspaceRole } from './context';
export interface WorkspaceCreationReservation {
    id: string;
    kind: string;
    resourceId: string;
    actorId: string;
    createdAt: number;
}
export interface Workspace extends MongoDBEntry {
    lifecycleRevision?: number;
    pendingCreations?: WorkspaceCreationReservation[];
    name: string;
    members: Array<{ userId: string; role: WorkspaceRole }>;
}
export const WorkspaceRepo = createMongoDBRepository<
    Workspace,
    {
        reserveCreation(
            id: string,
            reservation: WorkspaceCreationReservation,
        ): Promise<boolean>;
        completeCreation(id: string, reservationId: string): Promise<void>;
        deleteIfIdle(id: string, revision: number): Promise<boolean>;
        fresh(id: string): Promise<Workspace | null>;
        list(userId: string, elevated: boolean): Promise<Workspace[]>;
        rename(id: string, name: string): Promise<void>;
        member(
            id: string,
            userId: string,
            role: WorkspaceRole | null,
        ): Promise<void>;
    }
>({
    name: 'Workspace',
    collection: `${Config.storageScope}_workspaces`,
    schema: {
        ...MongoDBEntrySchema,
        lifecycleRevision: { __type: 'number', __required: false },
        pendingCreations: {
            __type: 'array',
            __required: false,
            __child: {
                __type: 'object',
                __content: {
                    id: { __type: 'string', __required: true },
                    kind: { __type: 'string', __required: true },
                    resourceId: { __type: 'string', __required: true },
                    actorId: { __type: 'string', __required: true },
                    createdAt: { __type: 'number', __required: true },
                },
            },
        },
        name: { __type: 'string', __required: true },
        members: {
            __type: 'array',
            __required: true,
            __child: {
                __type: 'object',
                __content: {
                    userId: { __type: 'string', __required: true },
                    role: { __type: 'string', __required: true },
                },
            },
        },
    },
    async beforeIndexes(mdb) {
        await mdb.updateOne(
            { _id: 'default' },
            {
                $setOnInsert: {
                    _id: 'default',
                    name: 'Default workspace',
                    members: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
            },
            { upsert: true },
        );
    },
    methods({ mdb, cache }) {
        return {
            async reserveCreation(id, reservation) {
                const result = await mdb.updateOne(
                    { _id: id },
                    {
                        $inc: { lifecycleRevision: 1 },
                        $push: { pendingCreations: reservation },
                    },
                );
                cache.remove(id);
                return result.matchedCount === 1;
            },
            async completeCreation(id, reservationId) {
                await mdb.updateOne(
                    { _id: id, 'pendingCreations.id': reservationId },
                    {
                        $inc: { lifecycleRevision: 1 },
                        $pull: { pendingCreations: { id: reservationId } },
                    },
                );
                cache.remove(id);
            },
            async deleteIfIdle(id, revision) {
                if (id === DEFAULT_WORKSPACE) return false;
                const result = await mdb.deleteOne({
                    _id: id,
                    $and: [
                        {
                            $or: [
                                { pendingCreations: { $exists: false } },
                                { pendingCreations: { $size: 0 } },
                            ],
                        },
                        revision === 0
                            ? {
                                  $or: [
                                      { lifecycleRevision: 0 },
                                      { lifecycleRevision: { $exists: false } },
                                  ],
                              }
                            : { lifecycleRevision: revision },
                    ],
                });
                cache.remove(id);
                return result.deletedCount === 1;
            },
            fresh: (id) => mdb.findOne({ _id: id }),
            list: (userId, elevated) =>
                mdb
                    .find(
                        elevated
                            ? {}
                            : {
                                  $or: [
                                      { _id: 'default' },
                                      { 'members.userId': userId },
                                  ],
                              },
                    )
                    .toArray(),
            async rename(id, name) {
                await mdb.updateOne(
                    { _id: id },
                    { $set: { name, updatedAt: Date.now() } },
                );
                cache.remove(id);
            },
            async member(id, userId, role) {
                // One atomic pipeline avoids dropped concurrent membership updates.
                await mdb.updateOne({ _id: id }, [
                    {
                        $set: {
                            updatedAt: Date.now(),
                            members: {
                                $concatArrays: [
                                    {
                                        $filter: {
                                            input: '$members',
                                            as: 'member',
                                            cond: {
                                                $ne: [
                                                    '$$member.userId',
                                                    { $literal: userId },
                                                ],
                                            },
                                        },
                                    },
                                    {
                                        $literal: role
                                            ? [{ userId, role }]
                                            : [],
                                    },
                                ],
                            },
                        },
                    },
                ]);
                cache.remove(id);
            },
        };
    },
});
