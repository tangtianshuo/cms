import { createLaunchDirectory } from './launch-results.mjs';
import { validatePublicationExpectation } from './publication-observation.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlatformLock } from '../release/platform-lock.mjs';
import { summarizePreview } from './preview-acceptance.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2] || 'formal';
const playwright = (spec, env = process.env) =>
    spawnSync(
        'npx',
        [
            'playwright',
            'test',
            '--config',
            'ops/e2e/playwright.config.mjs',
            spec,
        ],
        { cwd: root, env, stdio: 'inherit' },
    );
const code = (result) =>
    result.error || result.signal || result.status === null ? 1 : result.status;
if (
    mode === '--foundation' ||
    (mode === 'formal' && !process.env.STOREFRONT_E2E_PLATFORM_LOCK)
) {
    const result = playwright('ops/e2e/preview.spec.mjs');
    console.log(
        JSON.stringify({
            evidenceType: 'local-browser-foundation-not-acceptance',
            foundationPassed: code(result) === 0,
            overallB3Complete: false,
            incomplete: [
                'full-two-template-matrix',
                'actual-platform-lock',
                'actual-gateway-publication',
                'configured-public-host-TLS-and-identities',
            ],
        }),
    );
    process.exitCode =
        mode === '--foundation' ? code(result) : code(result) || 1;
} else if (mode === '--local') {
    const runId =
        new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const output = path.join(root, '.e2e/b3-matrix', runId);
    await mkdir(output, { recursive: true });
    const cells = [];
    let status = 0;
    for (const id of ['aeroframe', 'fireguard']) {
        const report = path.join(output, id + '-cells.json');
        const result = spawnSync(
            process.execPath,
            [
                'ops/e2e/browser-runtime.mjs',
                'run',
                '--',
                'npx',
                'playwright',
                'test',
                '--config',
                'ops/e2e/playwright.config.mjs',
                'ops/e2e/preview.spec.mjs',
                'ops/e2e/preview-matrix.spec.mjs',
            ],
            {
                cwd: root,
                env: {
                    ...process.env,
                    E2E_SECTION_TEMPLATE: id,
                    STOREFRONT_E2E_CELL_REPORT: report,
                    STOREFRONT_E2E_RESULTS_DIR: path.join(output, id),
                },
                stdio: 'inherit',
            },
        );
        status ||= code(result);
        try {
            cells.push(...JSON.parse(await readFile(report, 'utf8')).cells);
        } catch {
            status ||= 1;
        }
    }
    const mandatoryLocal = [
        'PREVIEW_DESKTOP',
        'PREVIEW_MOBILE',
        'LIVE_UNSAVED_PREVIEW',
        'NAVIGATION',
        'MEDIA',
        'STRUCTURED_CONTENT',
        'TEMPLATE_LAYOUT',
        'LOCAL_SAVED_RUNTIME',
    ];
    for (const id of ['aeroframe', 'fireguard'])
        for (const viewport of ['desktop', 'mobile'])
            for (const name of mandatoryLocal.filter(
                (name) =>
                    !name.startsWith('PREVIEW_') ||
                    name ===
                        (viewport === 'desktop'
                            ? 'PREVIEW_DESKTOP'
                            : 'PREVIEW_MOBILE'),
            )) {
                const matched = cells.filter(
                    (cell) =>
                        cell.id === id + '/' + name &&
                        cell.viewport === viewport,
                );
                if (matched.length !== 1 || matched[0].status !== 'passed')
                    status ||= 1;
            }
    const report = {
        scope: 'local-two-template-preview-not-acceptance',
        runId,
        localPassed: status === 0,
        overallB3Complete: false,
        cells,
        pending: [
            'actual-full-PlatformLock',
            'actual-Gateway-publication-and-public-host-comparison',
            'configured-public-preview-TLS-and-authoritative-DNS',
            'production-deployment-D2',
        ],
    };
    await writeFile(
        path.join(output, 'local-summary.json'),
        JSON.stringify(report, null, 2),
    );
    console.log(
        JSON.stringify({
            scope: report.scope,
            localPassed: report.localPassed,
            overallB3Complete: false,
            report: path.join(output, 'local-summary.json'),
        }),
    );
    process.exitCode = status;
} else if (mode === 'formal') {
    const startedAt = new Date().toISOString();
    try {
        const lockBytes = await readFile(
                process.env.STOREFRONT_E2E_PLATFORM_LOCK,
            ),
            lock = validatePlatformLock(JSON.parse(lockBytes));
        const lockChecksum =
            'sha256:' + createHash('sha256').update(lockBytes).digest('hex');
        const matrix = JSON.parse(
            await readFile(process.env.STOREFRONT_E2E_MATRIX, 'utf8'),
        );
        if (!Array.isArray(matrix) || matrix.length !== 2)
            throw new Error(
                'Two actual template runtime configurations required',
            );
        const roots = {
            cms: root,
            gateway: process.env.E2E_GATEWAY_ROOT,
            templates: process.env.E2E_TEMPLATES_ROOT,
            preview: process.env.E2E_PREVIEW_ROOT,
        };
        for (const [key, directory] of Object.entries(roots)) {
            if (
                !directory ||
                execFileSync('git', ['rev-parse', 'HEAD'], {
                    cwd: directory,
                    encoding: 'utf8',
                }).trim() !== lock.repositories[key].commit ||
                execFileSync(
                    'git',
                    ['status', '--porcelain', '--untracked-files=normal'],
                    { cwd: directory, encoding: 'utf8' },
                ).trim()
            )
                throw new Error(
                    'Actual source checkout does not match PlatformLock',
                );
        }
        const registry = JSON.parse(
            await readFile(
                process.env.STOREFRONT_E2E_APPROVED_PREVIEW_REGISTRY,
                'utf8',
            ),
        );
        for (const template of lock.templates) {
            const record = registry.records?.find(
                (record) =>
                    record.id === template.id &&
                    record.version === template.version,
            );
            if (
                !record ||
                record.manifestChecksum !== template.manifestChecksum ||
                record.sourceCommit !== lock.repositories.templates.commit ||
                record.bundleDigest !== template.previewBundleDigest ||
                record.artifactDigest !== template.previewArtifactDigest
            )
                throw new Error(
                    'Approved installed preview identity differs from PlatformLock',
                );
        }
        const output = path.resolve(
            process.env.E2E_PREVIEW_OUTPUT_DIR ||
                path.join(
                    root,
                    'docs/verification/evidence/platform-delivery',
                    new Date().toISOString().replace(/[:.]/g, '-') +
                        '-' +
                        randomUUID(),
                ),
        );
        await createLaunchDirectory(output);
        const cells = [];
        let status = 0;
        for (const [templateId, templateVersion] of [
            ['aeroframe', '1.0.4'],
            ['fireguard', '1.0.1'],
        ]) {
            const item = matrix.find(
                (item) =>
                    item.templateId === templateId &&
                    item.templateVersion === templateVersion,
            );
            if (!item)
                throw new Error(
                    'Mandatory template runtime configuration missing',
                );
            for (const field of ['cms', 'previewOrigin', 'siteUrl']) {
                const url = new URL(item[field]);
                if (
                    url.protocol !== 'https:' ||
                    url.username ||
                    url.password ||
                    url.search ||
                    url.hash
                )
                    throw new Error(
                        'Formal configured origins require valid HTTPS',
                    );
            }
            validatePublicationExpectation({
                ...item,
                releaseId: item.expectedReleaseId,
                activeRevision: item.expectedActiveRevision,
                marker: item.publishedMarker,
            });
            const publishedTemplate = lock.templates.find(
                (t) => t.id === templateId,
            );
            const cellReport = path.join(output, templateId + '-cells.json');
            const result = playwright('ops/e2e/preview-matrix.spec.mjs', {
                ...process.env,
                E2E_SECTION_TEMPLATE: '',
                STOREFRONT_E2E_B3_INSTALLED: '',
                STOREFRONT_E2E_LOCAL_SNAPSHOT_PATH: '',
                STOREFRONT_E2E_LOCAL_RUNTIME_URL: '',
                STOREFRONT_E2E_MEDIA_SPKI: '',
                STOREFRONT_E2E_MEDIA_ORIGIN: '',
                NODE_TLS_REJECT_UNAUTHORIZED: '1',
                STOREFRONT_E2E_EXPECTED_BUNDLE_DIGEST: lock.templates.find(
                    (t) => t.id === templateId,
                ).previewBundleDigest,
                STOREFRONT_E2E_EXPECTED_PREVIEW_ORIGIN: item.previewOrigin,
                STOREFRONT_E2E_FORMAL_PREVIEW: '1',
                STOREFRONT_E2E_EXPECTED_RELEASE_ID:
                    item.expectedReleaseId || '',
                STOREFRONT_E2E_EXPECTED_ACTIVE_REVISION: String(
                    item.expectedActiveRevision,
                ),
                STOREFRONT_E2E_EXPECTED_IMAGE_DIGEST:
                    publishedTemplate.imageDigest,
                STOREFRONT_E2E_EXPECTED_MANIFEST_CHECKSUM:
                    publishedTemplate.manifestChecksum,
                STOREFRONT_E2E_EXPECTED_SOURCE_COMMIT:
                    lock.repositories.templates.commit,
                STOREFRONT_E2E_PUBLISHED_MARKER: item.publishedMarker || '',
                STOREFRONT_E2E_TEMPLATE_ID: templateId,
                STOREFRONT_E2E_TEMPLATE_VERSION: templateVersion,
                STOREFRONT_E2E_CMS: item.cms,
                STOREFRONT_E2E_SITE_URL: item.siteUrl,
                STOREFRONT_E2E_SITE_ID: item.siteId,
                STOREFRONT_E2E_WORKSPACE_ID: item.workspaceId,
                STOREFRONT_E2E_LOCK_CHECKSUM: lockChecksum,
                STOREFRONT_E2E_CELL_REPORT: cellReport,
                STOREFRONT_E2E_RESULTS_DIR: path.join(output, templateId),
            });
            status ||= code(result);
            cells.push(...JSON.parse(await readFile(cellReport, 'utf8')).cells);
        }
        const result = summarizePreview({
            lockBytes,
            cells: cells.filter(
                (cell) => !cell.id.endsWith('/LOCAL_SAVED_RUNTIME'),
            ),
            environment: process.env.STOREFRONT_E2E_ENVIRONMENT,
            startedAt,
        });
        await writeFile(
            path.join(output, 'preview-AcceptanceEvidence.json'),
            JSON.stringify(result.evidence, null, 2),
        );
        console.log(
            JSON.stringify({
                evidenceType: 'AcceptanceEvidence',
                scope: 'B3-subset-only',
                passed: result.passed,
                overallB3Complete: false,
                path: path.join(output, 'preview-AcceptanceEvidence.json'),
            }),
        );
        process.exitCode = status || (!result.passed ? 1 : 0);
    } catch {
        console.log(
            JSON.stringify({
                scope: 'formal-preview-blocked',
                overallB3Complete: false,
                reason: 'Actual complete lock, matching sources/approved registry, configured HTTPS runtime matrix and mandatory browser/publication results required',
            }),
        );
        process.exitCode = 1;
    }
} else {
    console.error(
        'Usage: node ops/e2e/preview-roundtrip.mjs [--foundation|--local]',
    );
    process.exitCode = 1;
}
