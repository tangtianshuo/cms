import { test, expect } from './browser-fixture.mjs';
import { runPreviewScenarios } from './launch-preview.mjs';
import { openHero, save } from './launch-workspace.mjs';
test('supporting local artifact renderer executes D1 effective-field and retirement scenarios', async ({
    page,
    installation,
}) => {
    test.skip(
        !process.env.E2E_B3_TEMPLATES_ROOT,
        'Explicit local artifact fixture only',
    );
    test.setTimeout(120000);
    page.setDefaultTimeout(15000);
    const current = await page.evaluate(async () =>
        window.bcms.sdk.studio.getSite(),
    );
    const marker = 'D1-preview-branch-' + current.site.presetId;
    const field = await openHero(page);
    await field.fill(marker);
    await save(page);
    const proof = {
        scope: 'supporting-local-installed-artifact-not-formal-acceptance',
        site: {
            cmsWorkspaceId: process.env.STOREFRONT_E2E_WORKSPACE_ID,
            cmsSiteId: process.env.STOREFRONT_E2E_SITE_ID,
        },
        checks: {},
    };
    await runPreviewScenarios({
        page,
        proof,
        marker,
        target: {
            id: current.site.presetId,
            version: current.site.presetVersion,
        },
        local: true,
        results: [],
        capture: async (name, operation) => {
            console.log('D1 local Preview step ' + name);
            proof.checks[name] = await test.step(name, operation);
        },
    });
    expect(proof.previewStatus).toBe('ready');
    expect(Object.keys(proof.checks)).toHaveLength(4);
});
