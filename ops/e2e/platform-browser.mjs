// F1's B3 subset executes inside D1's owned lifecycle, before its teardown.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { acceptanceTemplates } from './acceptance-report.mjs';
import { validatePublicationExpectation } from './publication-observation.mjs';
const checksum = (bytes) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex');
export function ownedHttpsPort(host, routes, fallback) {
    const key = (host || '').toLowerCase().split(':')[0];
    if (!routes?.has(key)) return fallback;
    const port = routes.get(key);
    assert.ok(
        Number.isSafeInteger(port) && port > 0 && port < 65536,
        'Invalid owned HTTPS port',
    );
    return port;
}
export async function verifyOwnedUi(origin, directory) {
    const hashes = {};
    const visit = async (relative = '') => {
        for (const entry of fs.readdirSync(path.join(directory, relative), {
            withFileTypes: true,
        })) {
            const name = path.join(relative, entry.name);
            if (entry.isDirectory()) {
                await visit(name);
                continue;
            }
            if (!entry.isFile() || !/\.(html|js|css)$/.test(name)) continue;
            const response = await fetch(
                new URL(
                    name === 'index.html'
                        ? '/d'
                        : '/' + name.split(path.sep).join('/'),
                    origin,
                ),
                { signal: AbortSignal.timeout(15000) },
            );
            assert.equal(response.status, 200, 'Owned UI asset unavailable');
            const expected = checksum(
                fs.readFileSync(path.join(directory, name)),
            );
            assert.equal(
                checksum(Buffer.from(await response.arrayBuffer())),
                expected,
                'Public CMS differs from owned UI bytes',
            );
            hashes[name] = expected;
        }
    };
    await visit();
    assert.ok(
        hashes['index.html'] &&
            Object.keys(hashes).some((p) => p.endsWith('.js')),
        'Owned UI build missing',
    );
    return hashes;
}
export function ownedPreviewMatrix({
    sites,
    active,
    cmsOrigin,
    previewOrigin,
}) {
    for (const origin of [cmsOrigin, previewOrigin])
        assert.equal(
            new URL(origin).protocol,
            'https:',
            'Owned B3 requires HTTPS',
        );
    return acceptanceTemplates.map((target) => {
        const matching = sites.filter(
            (s) =>
                s.target?.id === target.id &&
                s.target.version === target.version,
        );
        assert.equal(matching.length, 1, 'Exact owned template site required');
        const site = matching[0],
            rows = active.filter((row) => row.siteId === site.siteId);
        assert.equal(rows.length, 1, 'Exact owned active deployment required');
        const row = rows[0];
        const item = {
            templateId: target.id,
            templateVersion: target.version,
            cms: cmsOrigin,
            previewOrigin,
            siteUrl: 'https://' + site.host,
            siteId: site.cmsSiteId,
            workspaceId: site.cmsWorkspaceId,
            expectedReleaseId: row.releaseId,
            expectedActiveRevision: Number(row.routeRevision),
            publishedMarker: site.marker,
        };
        validatePublicationExpectation({
            ...item,
            releaseId: item.expectedReleaseId,
            activeRevision: item.expectedActiveRevision,
            marker: item.publishedMarker,
        });
        return item;
    });
}
export async function runOwnedPreviewMatrix(
    runtime,
    {
        env,
        runId,
        lockChecksum,
        cmsOrigin,
        previewOrigin,
        registryPath,
        output,
    },
) {
    const {
        report,
        sql,
        runRoot,
        processes,
        cmsRoot,
        browserEmail,
        browserPassword,
    } = runtime;
    const cmsAssets = await verifyOwnedUi(
        cmsOrigin,
        path.join(runRoot, 'ui/dist'),
    );
    const active = [];
    for (const site of report.sites) {
        active.push(
            ...(
                await sql.query(
                    'SELECT * FROM "ActiveDeployment" WHERE "siteId"=$1',
                    [site.siteId],
                )
            ).rows,
        );
        const publicResponse = await fetch('https://' + site.host, {
            signal: AbortSignal.timeout(15000),
        });
        const owned = await runtime.publicGet(site.host);
        assert.equal(
            publicResponse.status,
            owned.status,
            'B3 public host must reach owned runtime',
        );
        assert.equal(
            await publicResponse.text(),
            owned.body,
            'B3 public host must serve owned publication',
        );
        assert.ok(
            owned.body.includes(site.marker),
            'Current owned run marker absent',
        );
    }
    const matrix = ownedPreviewMatrix({
        sites: report.sites,
        active,
        cmsOrigin,
        previewOrigin,
    });
    const matrixPath = path.join(runRoot, 'platform-preview-matrix.json');
    fs.writeFileSync(matrixPath, JSON.stringify(matrix), { mode: 0o600 });
    const log = fs.openSync(
        path.join(runRoot, 'platform-preview.private.log'),
        'w',
        0o600,
    );
    const child = processes.spawn(
        process.execPath,
        ['ops/e2e/preview-roundtrip.mjs', 'formal'],
        {
            cwd: cmsRoot,
            env: {
                ...env,
                E2E_PREVIEW_OUTPUT_DIR: output,
                STOREFRONT_E2E_PLATFORM_LOCK: env.E2E_PLATFORM_LOCK,
                STOREFRONT_E2E_MATRIX: matrixPath,
                STOREFRONT_E2E_APPROVED_PREVIEW_REGISTRY: registryPath,
                STOREFRONT_E2E_ENVIRONMENT: 'isolated',
                STOREFRONT_E2E_EMAIL: browserEmail,
                STOREFRONT_E2E_PASSWORD: browserPassword,
                STOREFRONT_E2E_PRIVATE_DIR: path.join(runRoot, 'private'),
                E2E_SECTION_TEMPLATE: '',
                STOREFRONT_E2E_B3_INSTALLED: '',
                STOREFRONT_E2E_LOCAL_SNAPSHOT_PATH: '',
            },
            stdio: ['ignore', log, log],
        },
    );
    fs.closeSync(log);
    assert.equal(
        await processes.exit(child),
        0,
        'Owned B3 browser and teardown must pass',
    );
    const evidence = JSON.parse(
        fs.readFileSync(
            path.join(output, 'preview-AcceptanceEvidence.json'),
            'utf8',
        ),
    );
    const cells = acceptanceTemplates
        .flatMap(
            (t) =>
                JSON.parse(
                    fs.readFileSync(
                        path.join(output, t.id + '-cells.json'),
                        'utf8',
                    ),
                ).cells,
        )
        .filter((c) => !c.id.endsWith('/LOCAL_SAVED_RUNTIME'));
    assert.equal(evidence.lockChecksum, lockChecksum);
    return {
        ...evidence,
        scope: 'B3-subset-only',
        ownedRunId: runId,
        sourceCommits: Object.fromEntries(
            Object.entries(report.source).map(([k, v]) => [k, v.head]),
        ),
        sites: matrix,
        cmsAssets,
        cells,
    };
}
