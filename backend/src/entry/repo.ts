import { Repo } from '../repo';
import { prepareEntryWrite } from '../workspaces/content-references';
import { migrateEntryGroups } from '../entry-groups/migration';
import {
    type Entry,
    EntrySchema,
} from '@bcms/selfhosted-backend/entry/models/main';
import { createMongoDBRepository } from '@bcms/selfhosted-backend/_server/modules/mongodb';
import {
    createQueue,
    type Queue,
    QueueError,
} from '@bcms/selfhosted-utils/queue';
import type { EntryContentNodeWidgetAttr } from '@bcms/selfhosted-backend/entry/models/content';
import { workspaceContext } from '../workspaces/context';
import {
    SiteMutationConflict,
    withSiteMutation,
} from '../template-contract/site-mutation';

export interface EntryRepoMethods {
    findAllByTemplateId(templateId: string): Promise<Entry[]>;
    findAllByWidgetId(widgetId: string): Promise<Entry[]>;
}

export const EntryRepo = createMongoDBRepository<Entry, EntryRepoMethods>({
    name: 'Entry',
    collection: 'entries',
    schema: EntrySchema,
    beforeIndexes: migrateEntryGroups,
    async prepareWrite(entry) {
        await prepareEntryWrite(entry);
        if (!entry.siteId) return;
        const site = await Repo.siteInstallation.methods.findFresh(
            entry.siteId,
        );
        if (
            site?.models.length &&
            site.status !== 'importing' &&
            site.migrationState !== 'publishing' &&
            !site.models.some((model) => model.templateId === entry.templateId)
        ) {
            throw new SiteMutationConflict(
                'Site content changed; refresh before saving',
            );
        }
    },
    aroundWrite: (entries, action) => {
        const siteIds = [
            ...new Set(
                entries
                    .map((entry) => entry.siteId || workspaceContext()?.siteId)
                    .filter((siteId): siteId is string => !!siteId),
            ),
        ];
        let write = () =>
            Repo.entryGroup.methods.withWrites(
                entries.map((entry) => entry.groupId!),
                action,
            );
        for (const siteId of siteIds) {
            const nested = write;
            write = () => withSiteMutation(siteId, nested);
        }
        return write();
    },
    indexes: [
        {
            key: { workspaceId: 1, groupId: 1, titleKeys: 1 },
            name: 'workspace_group_language_title_unique',
            unique: true,
            partialFilterExpression: { titleKeys: { $type: 'array' } },
        },
    ],
    methods({ mdb, cache }) {
        const latches: {
            [key: string]: boolean;
        } = {};
        const queues: {
            [key: string]: Queue<Entry[]>;
        } = {};

        return {
            async findAllByTemplateId(templateId) {
                if (!queues[templateId]) {
                    queues[templateId] = createQueue();
                }
                const queue = await queues[templateId]({
                    name: 'template',
                    handler: async () => {
                        if (latches[templateId]) {
                            return cache.findMany(
                                (e) => e.templateId === templateId,
                            );
                        }
                        const result = await mdb.find({ templateId }).toArray();
                        cache.set(result);
                        latches[templateId] = true;
                        return result;
                    },
                }).wait;
                if (queue instanceof QueueError) {
                    throw queue.error;
                }
                return queue.data;
            },

            async findAllByWidgetId(widgetId: string) {
                if (!queues[widgetId]) {
                    queues[widgetId] = createQueue();
                }
                const queue = await queues[widgetId]({
                    name: 'template',
                    handler: async () => {
                        if (latches[widgetId]) {
                            return cache.findMany((entry) => {
                                return !!entry.content.find((content) => {
                                    return !!content.nodes.find((node) => {
                                        const attrs =
                                            node.attrs as EntryContentNodeWidgetAttr;
                                        return (
                                            attrs &&
                                            attrs.data &&
                                            attrs.data._id === widgetId
                                        );
                                    });
                                });
                            });
                        }
                        const result = await mdb
                            .find({
                                'content.nodes.attrs.data._id': widgetId,
                            })
                            .toArray();
                        cache.set(result);
                        latches[widgetId] = true;
                        return result;
                    },
                }).wait;
                if (queue instanceof QueueError) {
                    throw queue.error;
                }
                return queue.data;
            },
        };
    },
});
