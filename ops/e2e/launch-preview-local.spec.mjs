import { test, expect } from './browser-fixture.mjs';
import { runPreviewScenarios } from './launch-preview.mjs';
import { openHero, save } from './launch-workspace.mjs';
import { createLaunchSite, selectLaunchSite } from './launch-sites.mjs';
import { configureLocalPreviewSites } from './launch-preview-fixture.mjs';
test('supporting local artifact renderer executes D1 effective-field and retirement scenarios', async ({
    page,
    installation,
}) => {
    test.skip(
        !process.env.E2E_B3_TEMPLATES_ROOT,
        'Explicit local artifact fixture only',
    );
    test.setTimeout(240000);
    page.setDefaultTimeout(15000);
    const created = [];
    for (const label of ['first', 'second']) {
        const proof = {};
        await createLaunchSite({
            page,
            marker: 'D1-preview-' + label + '-' + Date.now(),
            target: { id: 'aeroframe', version: '1.0.0' },
            local: true,
            proof,
            capture: async (_name, operation) => operation(),
            waitProvisioning: false,
        });
        created.push(proof.site);
    }
    const fixture = await configureLocalPreviewSites(created);
    await selectLaunchSite(page, created[0]);
    const current = await page.evaluate(async () =>
        window.bcms.sdk.studio.getSite(),
    );
    const marker = 'D1-preview-branch-' + current.site.presetId;
    await (await openHero(page)).fill(marker);
    await save(page);
    const proof = {
        scope: 'supporting-local-installed-artifact-not-formal-acceptance',
        site: created[0],
        fixture,
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
        peerSite: created[1],
        peerMarker: marker + ' peer',
        results: [],
        capture: async (name, operation) => {
            console.log('D1 local Preview step ' + name);
            proof.checks[name] = await test.step(name, operation);
        },
    });
    await test
        .info()
        .attach('local-preview-proof', {
            body: JSON.stringify(proof, null, 2),
            contentType: 'application/json',
        });
    expect(proof.previewStatus).toBe('ready');
    expect(Object.keys(proof.checks)).toHaveLength(4);
});
