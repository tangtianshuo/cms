import type { Collection } from 'mongodb';
// Build the replacement constraint successfully before dropping either legacy
// index. Fail startup on conflicting data instead of silently weakening uniqueness.
async function removeLegacyIndex(collection: Collection<any>, name: string) {
    const indexes = await collection.indexes();
    if (indexes.some(index => index.name === name)) {
        try { await collection.dropIndex(name); }
        catch (error) { if ((error as { code?: number }).code !== 27) throw error; }
    }
}
export async function migrateTemplateIndex(collection: Collection<any>) {
    await collection.updateMany({ workspaceId: { $exists: false } }, { $set: { workspaceId: 'default' } });
    await collection.createIndex({ workspaceId: 1, name: 1 }, { name: 'workspace_template_name_unique', unique: true });
    await removeLegacyIndex(collection, 'template_name_unique');
}
export async function migrateSiteIndex(collection: Collection<any>) {
    await collection.updateMany({ workspaceId: { $exists: false } }, { $set: { workspaceId: 'default' } });
    await collection.createIndex({ workspaceId: 1, slot: 1 }, { name: 'workspace_site_slot_unique', unique: true });
    await removeLegacyIndex(collection, 'site_slot_unique');
}
