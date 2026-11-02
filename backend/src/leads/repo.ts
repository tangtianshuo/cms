import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import type { Lead, LeadStatus } from './model';
import { LeadSchema } from './model';

export const LeadRepo = createMongoDBRepository<Lead, {
    list(siteId: string, filter?: { status?: LeadStatus; search?: string; limit?: number; skip?: number }): Promise<Lead[]>;
    updateState(id: string, siteId: string, patch: { status?: LeadStatus; assignedTo?: string; notes?: string }): Promise<Lead | null>;
}>({
    name: 'Lead', collection: `${Config.storageScope}_leads`, workspaceScoped: false,
    schema: LeadSchema,
    indexes: [{ key: { siteId: 1, createdAt: -1 }, name: 'leads_by_site' }, { key: { siteId: 1, status: 1, createdAt: -1 }, name: 'leads_by_status' }],
    methods({ mdb }) {
        return {
            async list(siteId, filter = {}) {
                const query: Record<string, unknown> = { siteId };
                if (filter.status) query.status = filter.status;
                if (filter.search) query.$or = [{ name: { $regex: filter.search, $options: 'i' } }, { email: { $regex: filter.search, $options: 'i' } }, { message: { $regex: filter.search, $options: 'i' } }];
                return mdb.find(query as never).sort({ createdAt: -1 }).skip(filter.skip || 0).limit(Math.min(filter.limit || 50, 200)).toArray();
            },
            async updateState(id, siteId, patch) {
                const result = await mdb.findOneAndUpdate({ _id: id, siteId }, { $set: patch }, { returnDocument: 'after' });
                return result || null;
            },
        };
    },
});
