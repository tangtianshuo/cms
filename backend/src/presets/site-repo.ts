import { workspaceFilter, workspaceContext, ownerWorkspace, workspaceId } from '../workspaces/context';
import { migrateSiteIndex } from '../workspaces/migration';
import type { DomainPrimaryAudit } from '../site-domains/model';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const domainLock = new AsyncLocalStorage<{ siteId: string; token: string }>();
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import { type SiteInstallation, SiteInstallationSchema } from './site-model';

function installationDraft(site: SiteInstallation) {
    const { currentReleaseId: _release, publishedReleaseIds: _history,
        gatewayCurrentReleaseId: _gatewayRelease, gatewayPublishedReleaseIds: _gatewayHistory, gatewayActiveRevision: _gatewayRevision,
        primaryDomainId: _primary, domainRevision: _revision,
        domainMutationToken: _token, domainMutationUntil: _until, domainAuditOutbox: _outbox, workspaceId: _workspace, slot: _slot, templateNamespace: _namespace, contentGroupId: _group, ...draft } = site;
    return draft;
}

export const SiteInstallationRepo = createMongoDBRepository<SiteInstallation, {
    listWorkspace(id: string): Promise<SiteInstallation[]>;
    findSelected(): Promise<SiteInstallation | null>;
    findFresh(id: string): Promise<SiteInstallation | null>;
    withDomainLock<T>(siteId: string, action: () => Promise<T>): Promise<T>;
    setPrimaryDomain(siteId: string, id: string, audit: DomainPrimaryAudit): Promise<void>;
    pendingDomainAudits(siteId: string): Promise<DomainPrimaryAudit[]>;
    acknowledgeDomainAudit(siteId: string, eventId: string): Promise<void>;
    touchDomains(siteId: string): Promise<void>;
    findDefault(): Promise<SiteInstallation | null>;
    findDefaultFresh(): Promise<SiteInstallation | null>;
    updateImport(site: SiteInstallation): Promise<SiteInstallation>;
    saveDraft(site: SiteInstallation, expectedUpdatedAt: number): Promise<boolean>;
    activate(site: SiteInstallation, releaseId: string): Promise<boolean>;
    projectGatewayRelease(site: SiteInstallation, releaseId: string, revision: number): Promise<boolean>;
}>({
    name: 'SiteInstallation',
    collection: `${Config.storageScope}_site_installations`,
    schema: SiteInstallationSchema,
    beforeIndexes: migrateSiteIndex,
    indexes: [{ key: { workspaceId: 1, slot: 1 }, name: 'workspace_site_slot_unique', unique: true }],
    methods({ mdb, cache, identityCollection }) {
        return {
            async listWorkspace(id) { return mdb.find(workspaceFilter(id)).toArray(); },
            async findSelected() {
                const context = workspaceContext();
                return mdb.findOne({ ...workspaceFilter(), ...(context?.siteId ? { _id: context.siteId } : { slot: 'default' }) });
            },
            async findFresh(_id) { return identityCollection.findOne({ _id }); },
            async withDomainLock(siteId, action) {
                const token = randomUUID();
                const now = Date.now();
                const result = await mdb.updateOne({ _id: siteId, $or: [{ domainMutationUntil: { $exists: false } }, { domainMutationUntil: { $lt: now } }] },
                    { $set: { domainMutationToken: token, domainMutationUntil: now + 30000 } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                try { return await domainLock.run({ siteId, token }, action); }
                finally {
                    try { await mdb.updateOne({ _id: siteId, domainMutationToken: token }, { $unset: { domainMutationToken: '', domainMutationUntil: '' } }); }
                    catch (error) { console.error('Domain lease cleanup deferred until expiry', error); }
                    cache.remove(siteId);
                }
            },
            async setPrimaryDomain(siteId, id, audit) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId) throw new Error('Domain changed; reload');
                if (audit.siteId !== siteId || audit.domainId !== id || audit.operation !== 'primary' || audit.outcome !== 'committed') throw new Error('Invalid primary audit event');
                const revision = audit.bindingRevision - 1;
                const result = await mdb.updateOne({ _id: siteId, domainMutationToken: lock.token, domainMutationUntil: { $gt: Date.now() },
                    ...(revision === 0 ? { $or: [{ domainRevision: 0 }, { domainRevision: { $exists: false } }] } : { domainRevision: revision }),
                }, { $set: { primaryDomainId: id }, $inc: { domainRevision: 1 }, $push: { domainAuditOutbox: audit } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async pendingDomainAudits(siteId) { return (await mdb.findOne({ _id: siteId }))?.domainAuditOutbox?.slice(0, 50) || []; },
            async acknowledgeDomainAudit(siteId, eventId) { await mdb.updateOne({ _id: siteId }, { $pull: { domainAuditOutbox: { _id: eventId } } }); cache.remove(siteId); },
            async touchDomains(siteId) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId) throw new Error('Domain changed; reload');
                const result = await mdb.updateOne({ _id: siteId, domainMutationToken: lock.token, domainMutationUntil: { $gt: Date.now() } }, { $inc: { domainRevision: 1 } });
                if (result.matchedCount !== 1) throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async findDefaultFresh() {
                return mdb.findOne({ ...workspaceFilter('default'), slot: 'default' });
            },
            async updateImport(site) {
                if (ownerWorkspace(site) !== workspaceId() || (workspaceContext()?.siteId && workspaceContext()?.siteId !== site._id)) throw new Error('Site access denied');
                const draft = installationDraft(site);
                const updatedAt = Math.max(Date.now(), site.updatedAt + 1);
                const result = await mdb.updateOne({ ...workspaceFilter(), _id: site._id }, { $set: { ...draft, updatedAt } });
                if (result.matchedCount !== 1) throw new Error('Site not found in workspace');
                site.updatedAt = updatedAt;
                cache.remove(site._id);
                return (await mdb.findOne({ ...workspaceFilter(), _id: site._id }))!;
            },
            async saveDraft(site, expectedUpdatedAt) {
                if (ownerWorkspace(site) !== workspaceId() || (workspaceContext()?.siteId && workspaceContext()?.siteId !== site._id)) throw new Error('Site access denied');
                const draft = installationDraft(site);
                const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
                const result = await mdb.updateOne({ ...workspaceFilter(), _id: site._id, updatedAt: expectedUpdatedAt }, {
                    $set: { ...draft, updatedAt },
                });
                cache.remove(site._id);
                if (result.matchedCount === 1) site.updatedAt = updatedAt;
                return result.matchedCount === 1;
            },
            async projectGatewayRelease(site, releaseId, revision) {
                const result = await mdb.updateOne({ ...workspaceFilter(), _id: site._id,
                    $or: [{ gatewayActiveRevision: { $exists: false } }, { gatewayActiveRevision: { $lt: revision } },
                        { gatewayActiveRevision: revision, gatewayCurrentReleaseId: releaseId }],
                }, { $set: { gatewayCurrentReleaseId: releaseId, gatewayActiveRevision: revision },
                    $addToSet: { gatewayPublishedReleaseIds: releaseId } });
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async activate(site, releaseId) {
                const result = await mdb.updateOne({ ...workspaceFilter(), _id: site._id, updatedAt: site.updatedAt,
                    currentReleaseId: site.currentReleaseId || { $exists: false } }, {
                    $set: { currentReleaseId: releaseId, updatedAt: Math.max(Date.now(), site.updatedAt + 1) },
                    $addToSet: { publishedReleaseIds: releaseId },
                });
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async findDefault() {
                const cached = cache.find((item) => item.slot === 'default' && ownerWorkspace(item) === 'default');
                if (cached) return cached;
                const site = await mdb.findOne({ ...workspaceFilter('default'), slot: 'default' });
                if (site) cache.set(site);
                return site;
            },
        };
    },
});
