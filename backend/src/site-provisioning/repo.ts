import { randomUUID } from 'node:crypto';
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { MongoDBEntrySchema, type MongoDBEntry } from '../_server/modules/mongodb/entry';
import { Config } from '../config';
import { workspaceContext } from '../workspaces/context';
import { validateConfig } from '../presets/gateway-client';
import type { BindingReader, SiteGatewayBinding } from './model';

type BindingRecord = SiteGatewayBinding & MongoDBEntry;
export interface BindingMethods extends BindingReader {
    persist(binding: SiteGatewayBinding): Promise<SiteGatewayBinding>;
}

function publicBinding(value: SiteGatewayBinding): SiteGatewayBinding {
    return { cmsWorkspaceId: value.cmsWorkspaceId, cmsSiteId: value.cmsSiteId, workspaceId: value.workspaceId,
        siteId: value.siteId, siteUrl: value.siteUrl, source: value.source };
}

function assertSelected(cmsWorkspaceId: string, cmsSiteId: string) {
    const context = workspaceContext();
    if (!cmsWorkspaceId || !cmsSiteId || context?.workspaceId !== cmsWorkspaceId || context.siteId !== cmsSiteId) {
        throw new Error('Gateway binding access requires the exact verified site context');
    }
}

const repository = createMongoDBRepository<BindingRecord, BindingMethods>({
    name: 'SiteGatewayBinding', collection: `${Config.storageScope}_site_gateway_bindings`,
    // workspaceId is the Gateway identity, not a CMS content ownership field.
    workspaceScoped: false,
    schema: { ...MongoDBEntrySchema, ...Object.fromEntries(['cmsWorkspaceId', 'cmsSiteId', 'workspaceId', 'siteId', 'siteUrl', 'source']
        .map(key => [key, { __type: 'string', __required: true }])) },
    indexes: [
        { key: { cmsWorkspaceId: 1, cmsSiteId: 1 }, name: 'cms_site_binding_unique', unique: true },
        { key: { workspaceId: 1, siteId: 1 }, name: 'gateway_site_binding_unique', unique: true },
    ],
    methods({ mdb }) {
        return {
            async find(cmsWorkspaceId, cmsSiteId) {
                assertSelected(cmsWorkspaceId, cmsSiteId);
                const value = await mdb.findOne({ cmsWorkspaceId, cmsSiteId });
                return value ? publicBinding(value) : null;
            },
            async listProvisioned() {
                return (await mdb.find({ source: 'provisioned' }).toArray()).map(publicBinding);
            },
            async persist(input) {
                assertSelected(input.cmsWorkspaceId, input.cmsSiteId);
                const binding = publicBinding(input);
                if (!['provisioned', 'legacy'].includes(binding.source)) throw new Error('Invalid Gateway binding source');
                validateConfig({ ...binding, gatewayBaseUrl: 'https://binding-validation.invalid', serviceSecret: 'binding-validation' });
                const query = { cmsWorkspaceId: binding.cmsWorkspaceId, cmsSiteId: binding.cmsSiteId };
                const now = Date.now();
                try {
                    await mdb.updateOne(query, { $setOnInsert: { ...binding, _id: randomUUID(), createdAt: now, updatedAt: now } }, { upsert: true });
                } catch (cause) {
                    if ((cause as { code?: number })?.code !== 11000) throw cause;
                    // A concurrent identical insert may have won. Any different source/target is a conflict.
                    const existing = await mdb.findOne(query);
                    if (!existing || JSON.stringify(publicBinding(existing)) !== JSON.stringify(binding)) throw new Error('Gateway binding conflict');
                    return publicBinding(existing);
                }
                const stored = await mdb.findOne(query);
                if (!stored || JSON.stringify(publicBinding(stored)) !== JSON.stringify(binding)) throw new Error('Gateway binding conflict');
                return publicBinding(stored);
            },
        };
    },
});

/** Internal narrow API: generic repository updates must never reassign these identities. */
export const SiteGatewayBindingRepo = {
    collection: repository.collection,
    init: () => repository.init(),
    get methods() { return repository.methods; },
};
