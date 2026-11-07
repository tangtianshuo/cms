import {
    workspaceFilter,
    workspaceContext,
    ownerWorkspace,
    workspaceId,
} from '../workspaces/context';
import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { migrateSiteIndex } from '../workspaces/migration';
import type { DomainPrimaryAudit } from '../site-domains/model';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const domainLock = new AsyncLocalStorage<{ siteId: string; token: string }>();
import { createMongoDBRepository } from '../_server/modules/mongodb';
import { Config } from '../config';
import type {
    ProvisioningCode,
    ProvisioningStore,
} from '../site-provisioning/service';
import { type SiteInstallation, SiteInstallationSchema } from './site-model';
import {
    setSiteMutationStore,
    type SiteMutationMode,
} from '../template-contract/site-mutation';

function installationDraft(site: SiteInstallation) {
    const {
        provisioning: _provisioning,
        creationRequestKey: _creationKey,
        creationName: _creationName,
        currentReleaseId: _release,
        publishedReleaseIds: _history,
        gatewayCurrentReleaseId: _gatewayRelease,
        gatewayPublishedReleaseIds: _gatewayHistory,
        gatewayActiveRevision: _gatewayRevision,
        primaryDomainId: _primary,
        domainRevision: _revision,
        domainMutationToken: _token,
        domainMutationUntil: _until,
        domainAuditOutbox: _outbox,
        workspaceId: _workspace,
        slot: _slot,
        templateNamespace: _namespace,
        contentGroupId: _group,
        ...draft
    } = site;
    return draft;
}

function migrationInstallationDraft(site: SiteInstallation) {
    const {
        provisioning: _provisioning,
        creationRequestKey: _creationKey,
        creationName: _creationName,
        primaryDomainId: _primary,
        domainRevision: _revision,
        domainMutationToken: _token,
        domainMutationUntil: _until,
        domainAuditOutbox: _outbox,
        workspaceId: _workspace,
        slot: _slot,
        migrationMutationToken: _migrationToken,
        migrationMutationUntil: _migrationUntil,
        migrationState: _migrationState,
        migrationOperationId: _migrationOperationId,
        ...complete
    } = site;
    return complete;
}

export const SiteInstallationRepo = createMongoDBRepository<
    SiteInstallation,
    {
        createOnce(site: SiteInstallation): Promise<SiteInstallation>;
        claimProvisioning: ProvisioningStore['claim'];
        completeProvisioning(siteId: string, token: string): Promise<boolean>;
        deferProvisioning(
            siteId: string,
            token: string,
            nextAttemptAt: number,
            code: ProvisioningCode,
        ): Promise<boolean>;
        retryProvisioning(siteId: string): Promise<boolean>;
        listWorkspace(id: string): Promise<SiteInstallation[]>;
        findSelected(): Promise<SiteInstallation | null>;
        findFresh(id: string): Promise<SiteInstallation | null>;
        withDomainLock<T>(siteId: string, action: () => Promise<T>): Promise<T>;
        claimSiteMutation(
            siteId: string,
            token: string,
            mode: SiteMutationMode,
            operationId: string | undefined,
            now: number,
            leaseUntil: number,
        ): Promise<boolean>;
        releaseSiteMutation(siteId: string, token: string): Promise<boolean>;
        renewSiteMutation(
            siteId: string,
            token: string,
            leaseUntil: number,
        ): Promise<boolean>;
        settleMigrationState(
            siteId: string,
            operationId: string,
            status: 'active' | 'failed' | 'rolled-back',
        ): Promise<boolean>;
        siteMutationState(
            siteId: string,
        ): Promise<{
            status: 'idle' | 'publishing' | 'active' | 'failed' | 'rolled-back';
            operationId?: string;
        }>;
        finalizeMigration(
            siteId: string,
            operationId: string,
            expectedUpdatedAt: number,
            candidate: SiteInstallation,
        ): Promise<boolean>;
        restoreMigrationSite(
            siteId: string,
            operationId: string,
            expectedUpdatedAt: number,
            previous: SiteInstallation,
        ): Promise<boolean>;
        setPrimaryDomain(
            siteId: string,
            id: string,
            audit: DomainPrimaryAudit,
        ): Promise<void>;
        pendingDomainAudits(siteId: string): Promise<DomainPrimaryAudit[]>;
        acknowledgeDomainAudit(siteId: string, eventId: string): Promise<void>;
        touchDomains(siteId: string): Promise<void>;
        findDefault(): Promise<SiteInstallation | null>;
        findDefaultFresh(): Promise<SiteInstallation | null>;
        updateImport(site: SiteInstallation): Promise<SiteInstallation>;
        saveDraft(
            site: SiteInstallation,
            expectedUpdatedAt: number,
        ): Promise<boolean>;
        activate(site: SiteInstallation, releaseId: string): Promise<boolean>;
        projectGatewayRelease(
            site: SiteInstallation,
            releaseId: string,
            revision: number,
        ): Promise<boolean>;
    }
>({
    name: 'SiteInstallation',
    collection: `${Config.storageScope}_site_installations`,
    schema: SiteInstallationSchema,
    beforeIndexes: migrateSiteIndex,
    indexes: [
        {
            key: { workspaceId: 1, slot: 1 },
            name: 'workspace_site_slot_unique',
            unique: true,
        },
        {
            key: { workspaceId: 1, creationRequestKey: 1 },
            name: 'workspace_creation_request_unique',
            unique: true,
            partialFilterExpression: {
                creationRequestKey: { $type: 'string' },
            },
        },
    ],
    methods({ mdb, cache, identityCollection }) {
        return {
            async createOnce(site) {
                if (
                    !workspaceContext()?.admin ||
                    site.workspaceId !== workspaceId() ||
                    !site.creationRequestKey ||
                    !site.creationName ||
                    site.provisioning?.requestKey !== site.creationRequestKey
                )
                    throw new Error('Invalid site creation context');
                const query = {
                    ...workspaceFilter(),
                    creationRequestKey: site.creationRequestKey,
                };
                const equivalent = (stored: SiteInstallation | null) => {
                    if (!stored || stored.creationName !== site.creationName)
                        throw Object.assign(
                            new Error(
                                'Creation request key already used for different site parameters',
                            ),
                            { status: 409 },
                        );
                    return stored;
                };
                const prior = await mdb.findOne(query);
                if (prior) return equivalent(prior);
                // A duplicate-key response proves that this insert did not commit. Resolve it
                // inside the reservation so a racing replay cannot strand a deletion guard.
                const stored = await withWorkspaceCreation(
                    { kind: 'site', resourceId: site._id },
                    async () => {
                        try {
                            await identityCollection.insertOne(site);
                        } catch (cause) {
                            if ((cause as { code?: number })?.code !== 11000)
                                throw cause;
                        }
                        return identityCollection.findOne(query);
                    },
                );
                const result = equivalent(stored);
                cache.remove(result._id);
                return result;
            },
            async claimProvisioning(now) {
                // Reclaim exhausted workers independently of other due work so a busy
                // queue cannot prevent an administrator from retrying their site.
                await identityCollection.updateMany(
                    {
                        'provisioning.status': 'running',
                        'provisioning.attempts': { $gte: 8 },
                        'provisioning.leaseUntil': { $lte: now },
                    },
                    {
                        $set: {
                            'provisioning.status': 'failed',
                            'provisioning.lastError': 'gateway_unavailable',
                        },
                        $unset: {
                            'provisioning.leaseToken': '',
                            'provisioning.leaseUntil': '',
                        },
                    },
                );
                const site = await identityCollection.findOneAndUpdate(
                    {
                        'provisioning.attempts': { $lt: 8 },
                        $or: [
                            {
                                'provisioning.status': 'pending',
                                'provisioning.nextAttemptAt': { $lte: now },
                            },
                            {
                                'provisioning.status': 'running',
                                'provisioning.leaseUntil': { $lte: now },
                            },
                        ],
                    },
                    {
                        $set: {
                            'provisioning.status': 'running',
                            'provisioning.leaseToken': randomUUID(),
                            'provisioning.leaseUntil': now + 60000,
                        },
                        $inc: { 'provisioning.attempts': 1 },
                    },
                    {
                        returnDocument: 'after',
                        sort: { 'provisioning.nextAttemptAt': 1, _id: 1 },
                    },
                );
                if (!site) return null;
                cache.remove(site._id);
                if (!site.provisioning)
                    throw new Error('Claimed site has no preparation state');
                return {
                    cmsWorkspaceId: ownerWorkspace(site),
                    cmsSiteId: site._id,
                    name: site.creationName || site.name,
                    state: site.provisioning,
                };
            },
            async completeProvisioning(siteId, token) {
                const result = await identityCollection.updateOne(
                    {
                        _id: siteId,
                        'provisioning.status': 'running',
                        'provisioning.leaseToken': token,
                        'provisioning.leaseUntil': { $gt: Date.now() },
                    },
                    {
                        $set: { 'provisioning.status': 'ready' },
                        $unset: {
                            'provisioning.leaseToken': '',
                            'provisioning.leaseUntil': '',
                            'provisioning.lastError': '',
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async deferProvisioning(siteId, token, nextAttemptAt, code) {
                const result = await identityCollection.updateOne(
                    {
                        _id: siteId,
                        'provisioning.status': 'running',
                        'provisioning.leaseToken': token,
                    },
                    [
                        {
                            $set: {
                                'provisioning.status':
                                    code === 'gateway_unavailable'
                                        ? {
                                              $cond: [
                                                  {
                                                      $gte: [
                                                          '$provisioning.attempts',
                                                          8,
                                                      ],
                                                  },
                                                  'failed',
                                                  'pending',
                                              ],
                                          }
                                        : 'failed',
                                'provisioning.nextAttemptAt': nextAttemptAt,
                                'provisioning.lastError': code,
                            },
                        },
                        {
                            $unset: [
                                'provisioning.leaseToken',
                                'provisioning.leaseUntil',
                            ],
                        },
                    ],
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async retryProvisioning(siteId) {
                const result = await mdb.updateOne(
                    { _id: siteId, 'provisioning.status': 'failed' },
                    {
                        $set: {
                            'provisioning.status': 'pending',
                            'provisioning.attempts': 0,
                            'provisioning.nextAttemptAt': Date.now(),
                        },
                        $unset: {
                            'provisioning.leaseToken': '',
                            'provisioning.leaseUntil': '',
                            'provisioning.lastError': '',
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async listWorkspace(id) {
                return mdb.find(workspaceFilter(id)).toArray();
            },
            async findSelected() {
                const context = workspaceContext();
                return mdb.findOne({
                    ...workspaceFilter(),
                    ...(context?.siteId
                        ? { _id: context.siteId }
                        : { slot: 'default' }),
                });
            },
            async findFresh(_id) {
                return identityCollection.findOne({ _id });
            },
            async withDomainLock(siteId, action) {
                const token = randomUUID();
                const now = Date.now();
                const result = await mdb.updateOne(
                    {
                        _id: siteId,
                        $or: [
                            { domainMutationUntil: { $exists: false } },
                            { domainMutationUntil: { $lt: now } },
                        ],
                    },
                    {
                        $set: {
                            domainMutationToken: token,
                            domainMutationUntil: now + 30000,
                        },
                    },
                );
                if (result.matchedCount !== 1)
                    throw new Error('Domain changed; reload');
                try {
                    return await domainLock.run({ siteId, token }, action);
                } finally {
                    try {
                        await mdb.updateOne(
                            { _id: siteId, domainMutationToken: token },
                            {
                                $unset: {
                                    domainMutationToken: '',
                                    domainMutationUntil: '',
                                },
                            },
                        );
                    } catch (error) {
                        console.error(
                            'Domain lease cleanup deferred until expiry',
                            error,
                        );
                    }
                    cache.remove(siteId);
                }
            },
            async claimSiteMutation(
                siteId,
                token,
                mode,
                operationId,
                now,
                leaseUntil,
            ) {
                const lockAvailable = {
                    $or: [
                        { migrationMutationUntil: { $exists: false } },
                        { migrationMutationUntil: { $lt: now } },
                    ],
                };
                const query =
                    mode === 'migration'
                        ? {
                              _id: siteId,
                              ...lockAvailable,
                              $and: [
                                  {
                                      $or: [
                                          {
                                              migrationOperationId: {
                                                  $exists: false,
                                              },
                                          },
                                          { migrationOperationId: operationId },
                                          {
                                              migrationState: {
                                                  $in: [
                                                      'active',
                                                      'failed',
                                                      'rolled-back',
                                                  ] as const,
                                              },
                                          },
                                      ],
                                  },
                              ],
                          }
                        : {
                              _id: siteId,
                              ...lockAvailable,
                              migrationState: {
                                  $ne: 'publishing' as const,
                              },
                          };
                const result = await mdb.updateOne(query, {
                    $set: {
                        migrationMutationToken: token,
                        migrationMutationUntil: leaseUntil,
                        ...(mode === 'migration' && operationId
                            ? {
                                  migrationState: 'publishing',
                                  migrationOperationId: operationId,
                              }
                            : {}),
                    },
                });
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async releaseSiteMutation(siteId, token) {
                const result = await mdb.updateOne(
                    { _id: siteId, migrationMutationToken: token },
                    {
                        $unset: {
                            migrationMutationToken: '',
                            migrationMutationUntil: '',
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async renewSiteMutation(siteId, token, leaseUntil) {
                const result = await mdb.updateOne(
                    {
                        _id: siteId,
                        migrationMutationToken: token,
                    },
                    {
                        $set: {
                            migrationMutationUntil: leaseUntil,
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async settleMigrationState(siteId, operationId, status) {
                const result = await mdb.updateOne(
                    {
                        _id: siteId,
                        migrationOperationId: operationId,
                    },
                    {
                        $set: { migrationState: status },
                        $unset: {
                            migrationMutationToken: '',
                            migrationMutationUntil: '',
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async siteMutationState(siteId) {
                const site = await identityCollection.findOne({
                    _id: siteId,
                });
                if (!site) throw new Error('Site not found');
                const status = site.migrationState;
                return {
                    status:
                        status === 'publishing' ||
                        status === 'active' ||
                        status === 'failed' ||
                        status === 'rolled-back'
                            ? status
                            : 'idle',
                    ...(site.migrationOperationId
                        ? { operationId: site.migrationOperationId }
                        : {}),
                };
            },
            async finalizeMigration(
                siteId,
                operationId,
                expectedUpdatedAt,
                candidate,
            ) {
                const draft = migrationInstallationDraft(candidate);
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: siteId,
                        updatedAt: expectedUpdatedAt,
                        migrationOperationId: operationId,
                        migrationState: 'publishing',
                    },
                    {
                        $set: {
                            ...draft,
                            migrationState: 'active',
                            migrationOperationId: operationId,
                            updatedAt: Math.max(
                                Date.now(),
                                expectedUpdatedAt + 1,
                            ),
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async restoreMigrationSite(
                siteId,
                operationId,
                expectedUpdatedAt,
                previous,
            ) {
                const draft = migrationInstallationDraft(previous);
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: siteId,
                        updatedAt: expectedUpdatedAt,
                        migrationOperationId: operationId,
                    },
                    {
                        $set: {
                            ...draft,
                            migrationState: 'rolled-back',
                            migrationOperationId: operationId,
                            updatedAt: Math.max(
                                Date.now(),
                                expectedUpdatedAt + 1,
                            ),
                        },
                    },
                );
                cache.remove(siteId);
                return result.matchedCount === 1;
            },
            async setPrimaryDomain(siteId, id, audit) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId)
                    throw new Error('Domain changed; reload');
                if (
                    audit.siteId !== siteId ||
                    audit.domainId !== id ||
                    audit.operation !== 'primary' ||
                    audit.outcome !== 'committed'
                )
                    throw new Error('Invalid primary audit event');
                const revision = audit.bindingRevision - 1;
                const result = await mdb.updateOne(
                    {
                        _id: siteId,
                        domainMutationToken: lock.token,
                        domainMutationUntil: { $gt: Date.now() },
                        ...(revision === 0
                            ? {
                                  $or: [
                                      { domainRevision: 0 },
                                      { domainRevision: { $exists: false } },
                                  ],
                              }
                            : { domainRevision: revision }),
                    },
                    {
                        $set: { primaryDomainId: id },
                        $inc: { domainRevision: 1 },
                        $push: { domainAuditOutbox: audit },
                    },
                );
                if (result.matchedCount !== 1)
                    throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async pendingDomainAudits(siteId) {
                return (
                    (
                        await mdb.findOne({ _id: siteId })
                    )?.domainAuditOutbox?.slice(0, 50) || []
                );
            },
            async acknowledgeDomainAudit(siteId, eventId) {
                await mdb.updateOne(
                    { _id: siteId },
                    { $pull: { domainAuditOutbox: { _id: eventId } } },
                );
                cache.remove(siteId);
            },
            async touchDomains(siteId) {
                const lock = domainLock.getStore();
                if (!lock || lock.siteId !== siteId)
                    throw new Error('Domain changed; reload');
                const result = await mdb.updateOne(
                    {
                        _id: siteId,
                        domainMutationToken: lock.token,
                        domainMutationUntil: { $gt: Date.now() },
                    },
                    { $inc: { domainRevision: 1 } },
                );
                if (result.matchedCount !== 1)
                    throw new Error('Domain changed; reload');
                cache.remove(siteId);
            },
            async findDefaultFresh() {
                return mdb.findOne({
                    ...workspaceFilter('default'),
                    slot: 'default',
                });
            },
            async updateImport(site) {
                if (
                    ownerWorkspace(site) !== workspaceId() ||
                    (workspaceContext()?.siteId &&
                        workspaceContext()?.siteId !== site._id)
                )
                    throw new Error('Site access denied');
                const draft = installationDraft(site);
                const updatedAt = Math.max(Date.now(), site.updatedAt + 1);
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: site._id,
                        migrationState: { $ne: 'publishing' },
                    },
                    { $set: { ...draft, updatedAt } },
                );
                if (result.matchedCount !== 1)
                    throw new Error('Site not found in workspace');
                site.updatedAt = updatedAt;
                cache.remove(site._id);
                return (await mdb.findOne({
                    ...workspaceFilter(),
                    _id: site._id,
                }))!;
            },
            async saveDraft(site, expectedUpdatedAt) {
                if (
                    ownerWorkspace(site) !== workspaceId() ||
                    (workspaceContext()?.siteId &&
                        workspaceContext()?.siteId !== site._id)
                )
                    throw new Error('Site access denied');
                const draft = installationDraft(site);
                const updatedAt = Math.max(Date.now(), expectedUpdatedAt + 1);
                for (const page of draft.pages) {
                    if (
                        page.creationReceipt?.siteUpdatedAt === 0 &&
                        page.creationReceipt.expectedUpdatedAt ===
                            expectedUpdatedAt
                    )
                        page.creationReceipt.siteUpdatedAt = updatedAt;
                }
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: site._id,
                        updatedAt: expectedUpdatedAt,
                        migrationState: { $ne: 'publishing' },
                    },
                    {
                        $set: { ...draft, updatedAt },
                    },
                );
                cache.remove(site._id);
                if (result.matchedCount === 1) site.updatedAt = updatedAt;
                return result.matchedCount === 1;
            },
            async projectGatewayRelease(site, releaseId, revision) {
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: site._id,
                        $or: [
                            { gatewayActiveRevision: { $exists: false } },
                            { gatewayActiveRevision: { $lt: revision } },
                            {
                                gatewayActiveRevision: revision,
                                gatewayCurrentReleaseId: releaseId,
                            },
                        ],
                    },
                    {
                        $set: {
                            gatewayCurrentReleaseId: releaseId,
                            gatewayActiveRevision: revision,
                        },
                        $addToSet: { gatewayPublishedReleaseIds: releaseId },
                    },
                );
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async activate(site, releaseId) {
                const result = await mdb.updateOne(
                    {
                        ...workspaceFilter(),
                        _id: site._id,
                        updatedAt: site.updatedAt,
                        migrationState: { $ne: 'publishing' },
                        currentReleaseId: site.currentReleaseId || {
                            $exists: false,
                        },
                    },
                    {
                        $set: {
                            currentReleaseId: releaseId,
                            updatedAt: Math.max(Date.now(), site.updatedAt + 1),
                        },
                        $addToSet: { publishedReleaseIds: releaseId },
                    },
                );
                cache.remove(site._id);
                return result.matchedCount === 1;
            },
            async findDefault() {
                const cached = cache.find(
                    (item) =>
                        item.slot === 'default' &&
                        ownerWorkspace(item) === 'default',
                );
                if (cached) return cached;
                const site = await mdb.findOne({
                    ...workspaceFilter('default'),
                    slot: 'default',
                });
                if (site) cache.set(site);
                return site;
            },
        };
    },
});

setSiteMutationStore(SiteInstallationRepo.methods);
