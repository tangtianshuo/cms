import type { Collection } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { Repo } from '../repo';
import { Config } from '../config';
import { Storage } from '../storage/main';
import { MediaStorage } from '../media/storage';
import type { Media } from '../media/models/main';
import type { Entry } from '../entry/models/main';
import { workspaceContext, workspaceId, workspaceFilter, ownerWorkspace, runWithWorkspace } from '../workspaces/context';
import { revalidateWorkspace } from '../workspaces/revalidate';
import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { assertContentWrite, ContentScopeError, contentWriteError } from '../workspaces/scoped-collection';
import { buildCopyGraph, type CopySelection } from './graph';
import { copyRepository, copyDatabase, copyBatchCollection, invalidateCopyCaches } from './visibility';
import type { ResourceShare, ShareKind } from './repo';
import { defaultEntryGroupId } from '../entry-groups/repo';

const grants = () => copyRepository('ResourceShare').raw as Collection<ResourceShare>;
const batches = () => copyDatabase().collection<any>(copyBatchCollection);
const missing = () => Object.assign(new Error('Share not found or no longer authorized'), { status: 404 });
/** Capabilities are response-only, including those nested in rich text/props. */
const clean = <T>(value: T): T => {
    const visit = (item: any): any => {
        if (typeof item === 'string') {
            return item.replace(/([?&])cap=[^&#\s"']*/g, '$1').replace(/\?&/g, '?').replace(/[?&](?=#|$)/g, '');
        }
        if (Array.isArray(item)) return item.map(visit);
        if (!item || typeof item !== 'object') return item;
        return Object.fromEntries(Object.entries(item)
            .filter(([key]) => !['accessToken', 'accessTokenExpiresAt', 'copyBatchId', 'provenance', 'retentionPins', 'deletionPending'].includes(key))
            .map(([key, content]) => [key, visit(content)]));
    };
    return visit(value);
};
export const shareSummary = (share: ResourceShare) => ({
    _id: share._id, ownerWorkspaceId: share.ownerWorkspaceId, targetWorkspaceId: share.targetWorkspaceId,
    resourceType: share.resourceType, resourceId: share.resourceId, version: share.version,
    state: share.state, allowedUses: share.allowedUses, createdAt: share.createdAt, updatedAt: share.updatedAt,
    audit: share.audit,
});
export async function listShares(direction: 'incoming' | 'outgoing') {
    if (direction === 'outgoing' && !workspaceContext()?.admin) throw new ContentScopeError('Source workspace administrator required');
    const items = await grants().find({ [direction === 'incoming' ? 'targetWorkspaceId' : 'ownerWorkspaceId']: workspaceId() }).sort({ createdAt: -1 }).toArray();
    return items.map(item => shareSummary(item as ResourceShare));
}
export async function authorizedShare(id: string): Promise<ResourceShare> {
    const share = await grants().findOne({ _id: id, state: 'active', targetWorkspaceId: workspaceId() }) as ResourceShare | null;
    if (!share) throw missing();
    return share;
}
export async function previewShare(id: string) {
    const share = await authorizedShare(id);
    return { ...shareSummary(share), item: share.snapshot, entryProps: share.entryProps };
}
export async function createShare(input: { resourceType: ShareKind; resourceId: string; targetWorkspaceId: string }) {
    if (!workspaceContext()?.admin) throw new ContentScopeError('Source workspace administrator required');
    if (input.targetWorkspaceId === workspaceId()) throw Object.assign(new Error('Choose another target workspace'), { status: 400 });
    if (!await Repo.workspace.methods.fresh(input.targetWorkspaceId)) throw missing();
    const repository = { Entry: Repo.entry, Media: Repo.media, Widget: Repo.widget, Group: Repo.group }[input.resourceType];
    const source = await repository.findById(input.resourceId);
    if (!source || ownerWorkspace(source) !== workspaceId()) throw missing();
    const snapshot = clean(source);
    if (input.resourceType === 'Media' && (source as Media).type === 'DIR') throw Object.assign(new Error('Share individual files, not directories'), { status: 400 });
    const entryProps = input.resourceType === 'Entry' ? clean((await Repo.template.findById((source as Entry).templateId))?.props) : undefined;
    if (input.resourceType === 'Entry' && !entryProps) throw missing();
    const id = randomUUID(); const now = Date.now();
    const mediaStorageId = input.resourceType === 'Media' ? randomUUID() : undefined;
    const resource: ResourceShare = {
        _id: id, workspaceId: workspaceId(), ownerWorkspaceId: workspaceId(), targetWorkspaceId: input.targetWorkspaceId,
        resourceType: input.resourceType, resourceId: source._id, version: '', state: 'active', allowedUses: ['preview', 'copy'],
        snapshot, entryProps, mediaStorageId, activeCopies: [], createdAt: now, updatedAt: now,
        audit: [{ operation: 'grant', actorId: workspaceContext()!.actorId, at: now }],
    };
    return withWorkspaceCreation({ kind: 'resource-share', resourceId: id }, async () => {
        let binary: Buffer | undefined;
        let thumbnail: Buffer | undefined;
        if (mediaStorageId) {
            binary = await MediaStorage.read(source as Media) || undefined;
            if (!binary) throw Object.assign(new Error('Source media file is unavailable'), { status: 409 });
            if (['IMG', 'VID', 'GIF'].includes((source as Media).type)) {
                thumbnail = await MediaStorage.read(source as Media, { thumbnail: true }) || undefined;
                if (!thumbnail && ['IMG', 'VID'].includes((source as Media).type)) throw new Error('Source thumbnail is unavailable');
            }
        }
        resource.version = createHash('sha256').update(JSON.stringify({ snapshot, entryProps })).update(binary || '').update(thumbnail || '').digest('hex');
        if (mediaStorageId) {
            try {
                await Storage.fs.save([Config.storageScope, 'resource-share-files', mediaStorageId], binary!);
                if (thumbnail) await Storage.fs.save([Config.storageScope, 'resource-share-files', mediaStorageId + '.thumbnail'], thumbnail);
            } catch (error) {
                for (const file of [mediaStorageId, mediaStorageId + '.thumbnail']) {
                    if (await Storage.fs.exist([Config.storageScope, 'resource-share-files', file], true)) await Storage.fs.deleteFile([Config.storageScope, 'resource-share-files', file]);
                }
                throw error;
            }
        }
        // Retain immutable files if this acknowledged/uncertain insert fails: a
        // server-side insert may still commit. Operator recovery owns that case.
        await Repo.resourceShare.add(resource, true);
        return shareSummary(resource);
    });
}
export async function revokeShare(id: string) {
    if (!workspaceContext()?.admin) throw new ContentScopeError('Source workspace administrator required');
    const result = await grants().updateOne({ _id: id, ownerWorkspaceId: workspaceId(), state: 'active', activeCopies: { $size: 0 } }, {
        $set: { state: 'revoked', updatedAt: Date.now() },
        $push: { audit: { operation: 'revoke', actorId: workspaceContext()!.actorId, at: Date.now() } },
    });
    if (!result.matchedCount) {
        const share = await grants().findOne({ _id: id, ownerWorkspaceId: workspaceId() });
        if (!share) throw missing();
        if (share.state !== 'revoked') throw Object.assign(new Error('Share has an active or interrupted copy; retry after completion or operator recovery'), { status: 409 });
    }
    return { revoked: true };
}
export async function readSharedMedia(id: string) {
    const share = await authorizedShare(id);
    if (share.resourceType !== 'Media' || !share.mediaStorageId) throw missing();
    const data = await Storage.fs.read([Config.storageScope, 'resource-share-files', share.mediaStorageId]);
    return { data, media: share.snapshot as Media };
}
export async function copyShares(rootShareId: string, selections: CopySelection[]) {
    assertContentWrite();
    if (!selections.some(item => item.shareId === rootShareId && !item.targetId)) throw Object.assign(new Error('Include the root share as a new copy'), { status: 400 });
    if (new Set(selections.map(item => item.shareId)).size !== selections.length) throw Object.assign(new Error('Duplicate share selection'), { status: 400 });
    const shares = await Promise.all(selections.map(item => authorizedShare(item.shareId)));
    if (new Set(shares.map(item => item.ownerWorkspaceId)).size !== 1) throw Object.assign(new Error('A dependency graph must use grants from one source workspace'), { status: 400 });
    const id = randomUUID();
    const items = await buildCopyGraph(shares, selections, id);
    const created = items.filter(item => !item.reused);
    // Catch expected name failures before acquiring durable lifecycle/use permits.
    // The unique index remains the authority for concurrent racing copies.
    const names = new Set<string>();
    for (const item of created) if (item.kind === 'Entry') {
        const entry = item.document as Entry;
        for (const title of entry.titleKeys || []) {
            const key = JSON.stringify([entry.groupId, title]);
            if (names.has(key)) throw Object.assign(new Error('Two copied Entries have the same normalized title in the destination group'), { status: 409 });
            names.add(key);
        }
        if (entry.titleKeys?.length && await copyRepository('Entry').raw.findOne({ $and: [workspaceFilter(), { groupId: entry.groupId, titleKeys: { $in: entry.titleKeys } }] }, { projection: { _id: 1 } })) {
            throw Object.assign(new Error('An entry with this normalized title already exists in this group and language'), { status: 409 });
        }
    }
    const result = { batchId: id, rootId: items.find(item => item.share._id === rootShareId)!.document._id,
        items: items.map(item => ({ shareId: item.share._id, resourceType: item.kind, id: item.document._id, reused: item.reused })) };
    return withWorkspaceCreation({ kind: 'resource-copy', resourceId: id }, async () => {
        await batches().insertOne({ _id: id, workspaceId: workspaceId(), state: 'pending', createdAt: Date.now(), actorId: workspaceContext()!.actorId,
            grants: shares.map(share => ({ id: share._id, version: share.version, ownerWorkspaceId: share.ownerWorkspaceId })), result });
        const held: string[] = [];
        try {
            for (const share of shares.sort((a, b) => a._id.localeCompare(b._id))) {
                const reserved = await grants().updateOne({ _id: share._id, targetWorkspaceId: workspaceId(), state: 'active', version: share.version }, { $addToSet: { activeCopies: id } });
                if (!reserved.matchedCount) throw missing();
                held.push(share._id);
            }
            const entryGroupIds = created.filter(item => item.kind === 'Entry')
                .map(item => (item.document as Entry).groupId!);
            if (entryGroupIds.includes(defaultEntryGroupId())) {
                await Repo.entryGroup.methods.ensure();
            }
            return await Repo.entryGroup.methods.withWrites(entryGroupIds, async () => {
                for (const item of created) {
                    if (item.kind === 'Media') {
                        const media = item.document as Media;
                        const bytes = await Storage.fs.read([Config.storageScope, 'resource-share-files', item.share.mediaStorageId!]);
                        // Copy exact original and existing thumbnail; no shared storage IDs.
                        await Storage.fs.save([Config.storageScope, 'media', ...MediaStorage.resolveCloudPath(media).split('/')], bytes);
                        if (['IMG', 'VID', 'GIF'].includes(media.type) && await Storage.fs.exist([Config.storageScope, 'resource-share-files', item.share.mediaStorageId! + '.thumbnail'], true)) {
                            const thumbnail = await Storage.fs.read([Config.storageScope, 'resource-share-files', item.share.mediaStorageId! + '.thumbnail']);
                            await Storage.fs.save([Config.storageScope, 'media', media._id, 'thumbnail.png'], thumbnail);
                        }
                    }
                    await copyRepository(item.kind).raw.insertOne(item.document);
                }
                // A fresh target identity check before the single durable publication barrier.
                const fresh = await revalidateWorkspace(workspaceContext()!);
                await runWithWorkspace(fresh, async () => {
                    assertContentWrite();
                    await buildCopyGraph(shares, selections, id);
                });
                const committed = await batches().updateOne({ _id: id, workspaceId: workspaceId(), state: 'pending' }, { $set: { state: 'committed', committedAt: Date.now() } });
                if (!committed.matchedCount) throw new Error('Copy batch cannot commit');
                invalidateCopyCaches();
                for (const shareId of held) {
                    try { await grants().updateOne({ _id: shareId }, { $pull: { activeCopies: id } }); }
                    catch (error) { console.error('Share use acknowledgement deferred', error); }
                }
                return result;
            });
        } catch (error) {
            // Never roll back a possibly committed batch. CAS decides the outcome,
            // including a lost acknowledgement of the commit command.
            const failed = await batches().findOneAndUpdate({ _id: id, state: 'pending' }, { $set: { state: 'failed', failedAt: Date.now() } }, { returnDocument: 'after' });
            if (!failed) {
                const batch = await batches().findOne({ _id: id });
                if (batch?.state === 'committed') { invalidateCopyCaches(); return result; }
                throw error;
            }
            for (const item of created) {
                await copyRepository(item.kind).raw.deleteMany({ _id: item.document._id, copyBatchId: id });
                if (item.kind === 'Media') await Storage.fs.deleteDir([Config.storageScope, 'media', item.document._id]);
            }
            invalidateCopyCaches();
            // Existing workspace/group lifecycle protocol retains failed permits.
            // Grant permits also remain until an operator fences uncertain writes.
            contentWriteError(error, 'Entry');
        }
    });
}
