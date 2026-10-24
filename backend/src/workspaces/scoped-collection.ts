import { claimMediaDeletion } from '../media/retention';
import { copyVisibility, deferredFind } from '../resource-shares/visibility';
import type { Collection, Document, Db } from 'mongodb';
import { workspaceContext, contentFilter, canWriteContent, workspaceId } from './context';
import { withWorkspaceCreation } from './lifecycle';

export class ContentScopeError extends Error {
    readonly status = 403;
}
export function contentWriteError(error: unknown, kind?: string): never {
    if (kind === 'Entry' && (error as { code?: number })?.code === 11000) throw Object.assign(new Error('An entry with this normalized title already exists in this group and language'), { status: 409 });
    throw error;
}
export function assertContentWrite() {
    if (workspaceContext()?.role === 'viewer') throw new ContentScopeError('Workspace is read only');
}
export function stampOwnership<T extends { workspaceId?: string }>(document: T): T {
    assertContentWrite();
    if (document.workspaceId && document.workspaceId !== workspaceId()) throw new ContentScopeError('Resource workspace cannot be changed');
    document.workspaceId = workspaceId();
    return document;
}

/** All ordinary repository operations use this handle; raw handles are reserved
 * for specifically named identity lookups and startup migrations. */
export function scopedCollection<T extends Document>(raw: Collection<T>, prepare?: (value: T) => Promise<void>, kind?: string, aroundWrite?: <R>(entries: T[], action: () => Promise<R>) => Promise<R>, invalidate: () => void = () => {}, database?: Db): Collection<T> {
    const filter = (value: Document = {}, operation: 'get' | 'post' | 'put' | 'delete' = 'get') => ({ $and: [contentFilter(kind, operation), value] });
    const visible = async (value: Document = {}, operation: 'get' | 'post' | 'put' | 'delete' = 'get') => ({ $and: [filter(value, operation), ...(database ? [await copyVisibility(database)] : [{ copyBatchId: { $exists: false } }])] });
    const update = (value: Document) => {
        assertContentWrite();
        if (Array.isArray(value)) throw new ContentScopeError('Pipeline updates are not permitted on scoped resources');
        for (const [operator, changes] of Object.entries(value)) {
            for (const [path, content] of Object.entries(changes as Document)) {
                if (path === 'copyBatchId' || path.startsWith('copyBatchId.') || path === 'provenance' || path.startsWith('provenance.') || (operator === '$rename' && ['copyBatchId', 'provenance'].includes(String(content)))) throw new ContentScopeError('Copy provenance cannot be changed');
                if (path === 'workspaceId' || path.startsWith('workspaceId.') || (operator === '$rename' && content === 'workspaceId')) {
                    if (!['$set', '$setOnInsert'].includes(operator) || content !== workspaceId()) throw new ContentScopeError('Resource workspace cannot be changed');
                }
            }
        }
        return value;
    };
    const insert = async (documents: T[], action: () => Promise<unknown>) => {
        return withWorkspaceCreation({ kind: raw.collectionName, resourceId: documents.map(d => d._id).join(',') }, async () => {
            for (const document of documents) { if (document.copyBatchId || document.provenance) throw new ContentScopeError('Use the authorized copy operation'); stampOwnership(document); if (!canWriteContent(kind || '', document, 'post')) throw new ContentScopeError('Resource creation denied'); await prepare?.(document); }
            try { const result = await (aroundWrite ? aroundWrite(documents, action) : action()); invalidate(); return result; }
            catch (error) { invalidate(); return contentWriteError(error, kind); }
        });
    };
    return new Proxy(raw, { get(target, key) {
        if (key === 'find') return (query?: Document, ...args: unknown[]) => deferredFind(async () => (target as any).find(await visible(query), ...args));
        if (['findOne', 'countDocuments', 'deleteOne', 'deleteMany'].includes(String(key))) return async (query?: Document, ...args: unknown[]) => {
            const deleting = String(key).startsWith('delete');
            if (deleting) assertContentWrite();
            let scopedQuery: Document = await visible(query, deleting ? 'delete' : 'get');
            if (deleting && kind === 'Media') {
                const candidates = await target.find(scopedQuery as any, { projection: { _id: 1 } }).toArray();
                const ids = candidates.map(item => String(item._id));
                await claimMediaDeletion(ids);
                scopedQuery = { $and: [scopedQuery, { _id: { $in: ids }, deletionPending: true, retentionPins: { $not: { $elemMatch: { $exists: true } } } }] };
            }
            const result = await (target as any)[key](scopedQuery, ...args);
            if (deleting) invalidate();
            return result;
        };
        if (key === 'insertOne') return (document: T, ...args: unknown[]) => insert([document], () => (target as any).insertOne(document, ...args));
        if (key === 'insertMany') return (documents: T[], ...args: unknown[]) => insert(documents, () => (target as any).insertMany(documents, ...args));
        if (key === 'updateOne' || key === 'updateMany' || key === 'findOneAndUpdate') return async (query: Document, changes: Document, options?: Document) => {
            update(changes);
            if (prepare) throw new ContentScopeError('This resource requires a complete validated repository update');
            if (options?.upsert) {
                changes.$setOnInsert = { ...changes.$setOnInsert, workspaceId: workspaceId() };
                return withWorkspaceCreation({ kind: raw.collectionName, resourceId: String(query._id || '') }, async () => { const result = await (target as any)[key](await visible(query, 'put'), changes, options); invalidate(); return result; });
            }
            const result = await (target as any)[key](await visible(query, 'put'), changes, options); invalidate(); return result;
        };
        if (['aggregate', 'bulkWrite', 'replaceOne', 'findOneAndReplace', 'findOneAndDelete', 'estimatedDocumentCount', 'distinct', 'watch', 'rename', 'drop'].includes(String(key))) return () => { throw new ContentScopeError('Use a scoped repository operation'); };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
}
