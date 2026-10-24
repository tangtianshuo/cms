import { AsyncLocalStorage } from 'node:async_hooks';
import type { Collection, Db, Document } from 'mongodb';
import { Config } from '../config';
import { workspaceId } from '../workspaces/context';

export const copyBatchCollection = `${Config.storageScope}_resource_copy_batches`;
let database: Db;
export function copyDatabase() { if (!database) throw new Error('Copy database unavailable'); return database; }
const overlay = new AsyncLocalStorage<Map<string, Map<string, Document>>>();
const repositories = new Map<string, {
    raw: Collection<any>;
    prepare?: (item: any) => Promise<void>;
    invalidate: () => void;
}>();
export function registerCopyRepository(kind: string, value: { raw: Collection<any>; prepare?: (item: any) => Promise<void>; invalidate: () => void }, db: Db) {
    database = db;
    repositories.set(kind, value);
}
export function copyRepository(kind: string) {
    const value = repositories.get(kind);
    if (!value) throw new Error(`Repository unavailable: ${kind}`);
    return value;
}
export function invalidateCopyCaches() {
    for (const value of repositories.values()) value.invalidate();
}
export function copyOverlayItem(kind: string, id: string) {
    const value = overlay.getStore()?.get(kind)?.get(id);
    return value ? structuredClone(value) : undefined;
}
export function withCopyOverlay<T>(items: Array<{ kind: string; document: Document }>, action: () => Promise<T>) {
    const data = new Map<string, Map<string, Document>>();
    for (const { kind, document } of items) {
        if (!data.has(kind)) data.set(kind, new Map());
        data.get(kind)!.set(document._id, document);
    }
    return overlay.run(data, action);
}
/** A fresh lookup for every database operation. Never cache the precommit set. */
export async function copyVisibility(db: Db, owner = workspaceId()) {
    const batches = await db.collection<{ _id: string; workspaceId: string; state: string }>(copyBatchCollection).find({ workspaceId: owner, state: 'committed' }, { projection: { _id: 1 } }).toArray();
    return { $or: [{ copyBatchId: { $exists: false } }, { copyBatchId: { $in: batches.map(item => item._id) } }] };
}
/** Preserve Mongo's synchronous find().sort().limit() interface while deferring
 * the actual cursor until the durable commit barrier has been checked. */
export function deferredFind(create: () => Promise<any>): any {
    const chain: Array<{ key: string; args: any[] }> = [];
    let promise: Promise<any> | undefined;
    const cursor = () => promise ||= create().then(value => {
        for (const call of chain) value = value[call.key](...call.args);
        return value;
    });
    const proxy = new Proxy({}, { get(_target, key) {
        if (key === 'then') return undefined;
        if (key === Symbol.asyncIterator) return async function* () { for await (const item of await cursor()) yield item; };
        if (['toArray', 'next', 'hasNext', 'tryNext', 'close', 'forEach', 'count', 'explain'].includes(String(key))) return (...args: any[]) => cursor().then(value => value[key](...args));
        if (['sort', 'limit', 'skip', 'project', 'hint', 'batchSize', 'maxTimeMS', 'collation', 'map'].includes(String(key))) return (...args: any[]) => {
            if (promise) throw new Error('Cannot modify a started cursor');
            chain.push({ key: String(key), args }); return proxy;
        };
        throw new Error(`Unsupported deferred cursor operation: ${String(key)}`);
    } });
    return proxy;
}
