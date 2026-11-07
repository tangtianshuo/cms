import { test, expect } from './browser-fixture.mjs';
import {
    acceptanceTemplates,
    completeAcceptance,
} from './acceptance-report.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const enabled = process.env.STOREFRONT_E2E_LAUNCH === '1';
const local = process.env.STOREFRONT_E2E_LAUNCH_LOCAL === '1';
const runId = process.env.STOREFRONT_E2E_RUN_ID;
import { workspace, openContent, openHero, save } from './launch-workspace.mjs';
import { runEditorScenarios } from './launch-editor.mjs';
import { runPreviewScenarios } from './launch-preview.mjs';
import { runPublicationScenarios } from './launch-publish.mjs';
import { createLaunchSite, selectLaunchSite } from './launch-sites.mjs';
test('launch both exact targets with real peer sites', async ({
    page,
    traceSteps,
}, info) => {
    test.skip(!enabled, 'Dedicated launch runner required');
    test.setTimeout(900000);
    page.setDefaultTimeout(15000);
    const records = [];
    try {
        for (const target of acceptanceTemplates) {
            const marker = `D1-${runId}-${target.id}`;
            const results = [];
            const proof = {
                scope: local
                    ? 'supplementary-builtin-UI-not-exact-template-acceptance'
                    : 'formal-UI',
                runId,
                marker,
                target,
                lockChecksum: process.env.STOREFRONT_E2E_LOCK_CHECKSUM || null,
                checks: {},
            };
            const resultFile = path.join(
                process.env.STOREFRONT_E2E_LAUNCH_RESULTS,
                `${target.id}.json`,
            );
            const capture = async (name, operation) => {
                console.log('D1 step ' + target.id + '/' + name);
                try {
                    const details = await test.step(name, operation);
                    proof.checks[name] = {
                        status: 'passed',
                        ...(details || {}),
                    };
                    if (!local)
                        results.push({
                            id: `${target.id}/${name}`,
                            status:
                                details?.coverageComplete === false
                                    ? 'not-run'
                                    : 'passed',
                            reason:
                                details?.coverageComplete === false
                                    ? 'Partial subchecks executed; full required breadth remains unimplemented'
                                    : 'Actual authenticated UI/API assertions',
                            artifacts: [resultFile],
                        });
                    return true;
                } catch (error) {
                    proof.checks[name] = { status: 'failed' };
                    if (!local)
                        results.push({
                            id: `${target.id}/${name}`,
                            status: 'failed',
                            reason: 'Actual assertion failed; inspect sanitized browser evidence',
                            artifacts: [resultFile],
                        });
                    throw error;
                }
            };

            const record = {
                target,
                marker,
                results,
                proof,
                resultFile,
                capture,
            };
            records.push(record);
            await createLaunchSite({
                page,
                marker,
                target,
                local,
                proof,
                results,
                resultFile,
                capture,
            });
        }
        for (const record of records) {
            const { target, marker, results, proof, resultFile, capture } =
                record;
            const peer = records.find((other) => other !== record);
            if (!proof.site || !peer.proof.site) continue;
            await selectLaunchSite(page, proof.site);
            await runEditorScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                traceSteps,
            });
            await runPreviewScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                local,
                peerSite: peer.proof.site,
                peerMarker: peer.marker,
                results,
                resultFile,
            });
            await runPublicationScenarios({
                page,
                capture,
                proof,
                marker,
                target,
                runId,
                local,
            });
            proof.supplementaryCompleted = true;
        }
    } finally {
        for (const { target, proof, results, resultFile } of records) {
            await mkdir(path.dirname(resultFile), {
                recursive: true,
                mode: 0o700,
            });
            proof.cases = completeAcceptance(results).filter((x) =>
                x.id.startsWith(target.id + '/'),
            );
            const timelinePath = info.outputPath('interaction-timeline.json');
            await writeFile(
                timelinePath,
                JSON.stringify(traceSteps.finish(), null, 2),
                { mode: 0o600 },
            );
            await info.attach('interaction-timeline', {
                path: timelinePath,
                contentType: 'application/json',
            });
            await writeFile(resultFile, JSON.stringify(proof, null, 2), {
                mode: 0o600,
            });
            await info.attach('launch-proof', {
                path: resultFile,
                contentType: 'application/json',
            });
            if (!page.isClosed())
                await page.screenshot({
                    path: info.outputPath('launch-sanitized.png'),
                    fullPage: true,
                    mask: [
                        page.locator(
                            'input[type="password"],input[type="email"],[data-e2e-private]',
                        ),
                        page.getByText(process.env.STOREFRONT_E2E_EMAIL, {
                            exact: false,
                        }),
                    ],
                });
        }
    }
});
