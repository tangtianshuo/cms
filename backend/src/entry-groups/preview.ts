/** Read-only operator preview. Run with node -r ts-node/register -r tsconfig-paths/register src/entry-groups/preview.ts */
import { MongoClient } from 'mongodb';
import { previewEntryGroupMigration } from './migration';
import type { Entry } from '../entry/models/main';
async function main() {
    const uri = process.env.BCMS_ENTRY_GROUP_MIGRATION_MONGO;
    if (!uri) throw new Error('Set BCMS_ENTRY_GROUP_MIGRATION_MONGO including the target database name');
    const client = await MongoClient.connect(uri);
    try { console.log(JSON.stringify(await previewEntryGroupMigration(client.db().collection<Entry>('entries'), client.db()), null, 2)); }
    finally { await client.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
