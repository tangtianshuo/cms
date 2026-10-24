import { Config } from '../config';
import { createMongoDBRepository, MongoDBEntrySchema, type MongoDBEntry } from '../_server/modules/mongodb';
import type { Entry } from '../entry/models/main';
import type { Media } from '../media/models/main';
import type { Widget } from '../widget/models/main';
import type { Group } from '../group/models/main';
import type { Prop } from '../prop/models/main';
import { copyBatchCollection } from './visibility';

export type ShareKind = 'Entry' | 'Media' | 'Widget' | 'Group';
export type SharedResource = Entry | Media | Widget | Group;
export interface ResourceShare extends MongoDBEntry {
    ownerWorkspaceId: string;
    targetWorkspaceId: string;
    resourceType: ShareKind;
    resourceId: string;
    version: string;
    state: 'active' | 'revoked';
    allowedUses: ['preview', 'copy'];
    snapshot: SharedResource;
    entryProps?: Prop[];
    mediaStorageId?: string;
    activeCopies: string[];
    audit: Array<{ operation: 'grant' | 'revoke'; actorId: string; at: number }>;
}
export const ResourceShareRepo = createMongoDBRepository<ResourceShare>({
    name: 'ResourceShare', collection: `${Config.storageScope}_resource_shares`,
    schema: MongoDBEntrySchema,
    indexes: [{ key: { ownerWorkspaceId: 1, targetWorkspaceId: 1, state: 1 }, name: 'share_participants' }],
    async beforeIndexes(_collection, db) {
        await db!.collection(copyBatchCollection).createIndex({ workspaceId: 1, state: 1 });
    },
});
