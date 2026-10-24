import type { Collection, Db } from 'mongodb';
import { Config } from '../config';
import type { Entry } from '../entry/models/main';
import type { Template } from '../template/models/main';
import type { SiteInstallation } from '../presets/site-model';
import { withWorkspaceCreation } from '../workspaces/lifecycle';
import { runWithWorkspace, ownerWorkspace } from '../workspaces/context';
import { entryTitleKeys } from './names';
import { defaultEntryGroupId } from './repo';
export async function previewEntryGroupMigration(collection: Collection<Entry>, db: Db) {
    const templates = await db.collection<Template>(`${Config.storageScope}_templates`).find().toArray();
    const sites = await db.collection<SiteInstallation>(`${Config.storageScope}_site_installations`).find().toArray();
    const existingGroups = await db.collection<{ _id: string; workspaceId?: string }>(`${Config.storageScope}_entry_groups`).find().toArray();
    const groupOwners = new Map(existingGroups.map(group => [group._id, ownerWorkspace(group)]));
    const groupConflicts: Array<{ key: string; entryIds: string[] }> = [];
    const planned = (await collection.find().toArray()).map(entry => {
        const workspaceId = ownerWorkspace(entry);
        const site = sites.find(site => ownerWorkspace(site) === workspaceId && (site._id === entry.siteId || site.models?.some(model => model.templateId === entry.templateId && entry.userId === '__preset')));
        const groupId = entry.groupId || (site ? site.contentGroupId || site._id : defaultEntryGroupId(workspaceId));
        const priorOwner = groupOwners.get(groupId);
        if (priorOwner && priorOwner !== workspaceId) groupConflicts.push({ key: `Entry group ${groupId} belongs to another workspace`, entryIds: [entry._id] });
        else groupOwners.set(groupId, workspaceId);
        const titleKeys = entryTitleKeys(entry, templates.find(template => template._id === entry.templateId && ownerWorkspace(template) === workspaceId) || null);
        return { _id: entry._id, workspaceId, groupId, siteId: site?._id, titleKeys };
    });
    const occupied = new Map<string, string[]>();
    for (const entry of planned) for (const title of entry.titleKeys) {
        const key = JSON.stringify([entry.workspaceId, entry.groupId, title]);
        const ids = occupied.get(key) || []; ids.push(entry._id); occupied.set(key, ids);
    }
    return { entries: planned, conflicts: [...groupConflicts, ...[...occupied.entries()].filter(([, ids]) => ids.length > 1).map(([key, entryIds]) => ({ key, entryIds }))] };
}
export async function migrateEntryGroups(collection: Collection<Entry>, db?: Db) {
    if (!db) throw new Error('Entry migration requires database');
    const preview = await previewEntryGroupMigration(collection, db);
    if (preview.conflicts.length) throw new Error(`Entry title conflicts require explicit resolution: ${JSON.stringify(preview.conflicts)}`);
    const groups = db.collection(`${Config.storageScope}_entry_groups`);
    // Startup migration runs before accepting requests; conflicts are checked before writes.
    for (const entry of preview.entries) {
        await runWithWorkspace({ workspaceId: entry.workspaceId, actorId: '__migration', admin: true, instanceAdmin: true, role: 'admin' }, () => withWorkspaceCreation({ kind: 'entry-group-migration', resourceId: entry._id }, async () => {
        await groups.updateOne({ _id: entry.groupId as never }, { $setOnInsert: { workspaceId: entry.workspaceId, name: entry.siteId ? 'Site content' : 'General', siteId: entry.siteId, createdAt: Date.now(), updatedAt: Date.now(), revision: 0, pendingWrites: [] } }, { upsert: true });
        await collection.updateOne({ _id: entry._id }, { $set: { workspaceId: entry.workspaceId, groupId: entry.groupId, ...(entry.titleKeys.length ? { titleKeys: entry.titleKeys } : {}) }, ...(!entry.titleKeys.length ? { $unset: { titleKeys: '' } } : {}) });
        }));
    }
}
