import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const requireBackend = createRequire(
    new URL('../../backend/package.json', import.meta.url),
);
const { MongoClient } = requireBackend('mongodb');
// Local renderer configuration only. UI-created ownership, content and readiness are untouched.
export async function configureLocalPreviewSites(sites) {
    assert.ok(process.env.E2E_B3_TEMPLATES_ROOT);
    const fixture = JSON.parse(
        await readFile(process.env.STOREFRONT_E2E_D1_SITE_FIXTURE, 'utf8'),
    );
    assert.match(fixture.database, /^b3_browser_[a-f0-9]+$/);
    const mongo = new MongoClient(fixture.dbUrl);
    await mongo.connect();
    try {
        const installations = mongo
            .db(fixture.database)
            .collection('bcms_site_installations');
        const baseline = await installations.findOne({
            _id: fixture.baselineSiteId,
        });
        assert.ok(baseline && !baseline.publishedTemplateRecord);
        for (const site of sites) {
            const owned = await installations.findOne({ _id: site.cmsSiteId });
            assert.equal(owned.workspaceId, site.cmsWorkspaceId);
            assert.equal(owned.presetId, 'aeroframe');
            assert.equal(owned.presetVersion, '1.0.0');
            await installations.updateOne(
                { _id: owned._id, workspaceId: site.cmsWorkspaceId },
                {
                    $set: {
                        presetId: baseline.presetId,
                        presetVersion: baseline.presetVersion,
                        presetManifestSnapshot: baseline.presetManifestSnapshot,
                        theme: baseline.theme,
                        pages: baseline.pages,
                    },
                    $unset: { publishedTemplateRecord: '' },
                },
            );
        }
        return {
            scope: 'UI-created-builtin-sites-with-local-normalized-renderer-config-not-public-acceptance',
            templateId: baseline.presetId,
            templateVersion: baseline.presetVersion,
            sites,
        };
    } finally {
        await mongo.close();
    }
}
