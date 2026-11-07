import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requiredAcceptanceIds } from '../e2e/acceptance-report.mjs';
import { requiredPreviewCells } from '../e2e/preview-acceptance.mjs';
import {
    assertPlatformGate,
    verifyCandidateArtifacts,
} from './verify-platform.mjs';
const hash = (v) => 'sha256:' + createHash('sha256').update(v).digest('hex');
const digest = (n) => 'sha256:' + String(n).repeat(64);
function fixture() {
    const repositories = Object.fromEntries(
        ['cms', 'gateway', 'templates', 'preview'].map((key) => [
            key,
            { repository: `owner/${key}`, commit: 'a'.repeat(40) },
        ]),
    );
    const templates = ['aeroframe', 'fireguard'].map((id, i) => ({
        id,
        version: i ? '1.0.1' : '1.0.4',
        manifestChecksum: digest(1),
        imageDigest: digest(i + 2),
        previewArtifactDigest: digest(4),
        previewBundleDigest: digest(5),
    }));
    const lock = {
        schemaVersion: 1,
        contractVersion: 1,
        repositories,
        templates,
    };
    const lockBytes = Buffer.from(JSON.stringify(lock));
    const now = Date.now(),
        startedAt = new Date(now - 119000).toISOString(),
        completedAt = new Date(now - 60000).toISOString();
    const cases = requiredAcceptanceIds.map((id) => ({
        id,
        status: 'passed',
        reason: 'real-format unit fixture only',
        artifacts: ['proof.json'],
    }));
    const evidence = {
        schemaVersion: 1,
        lockChecksum: hash(lockBytes),
        environment: 'isolated',
        startedAt,
        completedAt,
        cases,
    };
    const source = Object.fromEntries(
        Object.entries(repositories).map(([k, v]) => [
            k,
            { commit: v.commit, workingTree: '', diffChecksum: hash('') },
        ]),
    );
    const candidates = {
        schemaVersion: 1,
        services: Object.fromEntries(
            ['cms', 'gateway', 'preview'].map((k, i) => [
                k,
                {
                    image: `ghcr.io/owner/${k}@${digest(i + 6)}`,
                    version: '1.0.0',
                },
            ]),
        ),
        templates: templates.map((t) => ({
            ...t,
            image: `ghcr.io/owner/templates/${t.id}@${t.imageDigest}`,
        })),
    };
    const images = Object.fromEntries(
        [
            ...Object.keys(candidates.services),
            ...templates.map((t) => `${t.id}-${t.version}`),
        ].map((k, i) => [
            k,
            {
                imageId: hash(k),
                sourceCommit: 'a'.repeat(40),
                reference:
                    i < 3
                        ? candidates.services[k].image
                        : candidates.templates[i - 3].image,
                provenanceVerified: true,
            },
        ]),
    );
    const services = [
        { kind: 'cms', imageId: images.cms.imageId },
        { kind: 'gateway-control', imageId: images.gateway.imageId },
        { kind: 'gateway-ingest', imageId: images.gateway.imageId },
        ...templates.map((t) => ({
            kind: `${t.id}@${t.version}`,
            imageId: images[`${t.id}-${t.version}`].imageId,
            configuredImage: images[`${t.id}-${t.version}`].imageId,
            authoritativeImage: images[`${t.id}-${t.version}`].imageId,
            active: { imageDigest: images[`${t.id}-${t.version}`].imageId },
        })),
    ];
    const common = {
        schemaVersion: 1,
        evidenceType: 'isolated-local-candidate',
        passed: true,
        sourceIdentities: repositories,
        services,
        startedAt,
        completedAt,
        cleanup: {
            childProcessesRemaining: [],
            servicesStopped: [],
            errors: [],
        },
    };
    const a4 = {
        build: { repositories, images },
        matrix: {
            ...common,
            cases: templates.flatMap((t) =>
                ['cms', 'gateway-control', 'worker', 'gateway-ingest'].map(
                    (s) => ({
                        id: `${t.id}@${t.version}:${s}-stopped`,
                        status: 'passed',
                    }),
                ),
            ),
        },
        publication: {
            ...common,
            cases: templates.flatMap((t) =>
                [
                    'draft-isolation-publish-rollback',
                    'real-local-publish-idempotency-stale-rejection',
                    'artifact-integrity-failure',
                    'worker-restart-recovery',
                ].map((s) => ({
                    id: `${t.id}@${t.version}:${s}`,
                    status: 'passed',
                })),
            ),
        },
    };
    const verification = {
        schemaVersion: 1,
        runtimeCleanupVerified: true,
        runId: 'current-run',
        startedAt: new Date(now - 120000).toISOString(),
        completedAt: new Date(now - 1000).toISOString(),
        launch: {
            schemaVersion: 1,
            evidenceType: 'lock-bound-launch-results',
            runId: 'launch-run',
            lockChecksum: evidence.lockChecksum,
            startedAt,
            completedAt,
            source,
            passed: true,
            cleanupVerified: true,
            formalGate: null,
            cases,
        },
        owned: {
            scope: 'formal-owned-runtime',
            runId: 'launch-run',
            lockChecksum: evidence.lockChecksum,
            assertionsPassed: true,
            cleanupVerified: true,
            source: Object.fromEntries(
                Object.entries(repositories).map(([k, v]) => [
                    k,
                    { head: v.commit, files: [] },
                ]),
            ),
            cleanup: {
                sqlAbsent: true,
                mongoAbsent: true,
                processGroups: [],
                remainingContainers: [],
                portsClosed: { cms: true, gateway: true },
            },
            artifacts: templates.map((t) => ({
                target: { id: t.id, version: t.version },
                image: `ghcr.io/owner/templates/${t.id}@${t.imageDigest}`,
                previewArtifactDigest: t.previewArtifactDigest,
                previewBundleDigest: t.previewBundleDigest,
            })),
        },
        a4,
        b3: {
            schemaVersion: 1,
            scope: 'B3-subset-only',
            startedAt,
            completedAt,
            lockChecksum: evidence.lockChecksum,
            environment: 'isolated',
            cells: requiredPreviewCells(lock).map((c) => ({
                ...c,
                lockChecksum: evidence.lockChecksum,
                status: 'passed',
                reason: 'unit only',
                artifacts: ['preview-proof.json'],
            })),
        },
    };
    verification.owned.sites = templates.map((target, i) => ({
        target,
        cmsSiteId: 'cms-' + i,
        cmsWorkspaceId: 'workspace-' + i,
    }));
    Object.assign(verification.b3, {
        ownedRunId: 'launch-run',
        sourceCommits: Object.fromEntries(
            Object.entries(repositories).map(([k, v]) => [k, v.commit]),
        ),
        cmsAssets: { 'index.html': digest(1), 'assets/main.js': digest(2) },
        sites: verification.owned.sites.map((s) => ({
            templateId: s.target.id,
            templateVersion: s.target.version,
            siteId: s.cmsSiteId,
            workspaceId: s.cmsWorkspaceId,
        })),
    });
    return {
        lock,
        lockBytes,
        evidence,
        actualCommits: Object.fromEntries(
            Object.entries(repositories).map(([k, v]) => [k, v.commit]),
        ),
        actualSources: source,
        verification,
        candidates,
        expectedRunId: 'current-run',
    };
}
test('source drift is refused before test results', () => {
    const f = fixture();
    f.actualCommits.cms = 'b'.repeat(40);
    f.evidence = { cases: [] };
    assert.throws(() => assertPlatformGate(f), /source_drift:cms/);
});
test('complete authentic-format composition passes (fixture is not release proof)', () =>
    assert.doesNotThrow(() => assertPlatformGate(fixture())));
for (const status of ['failed', 'blocked', 'not-run'])
    test(`rejects every mandatory ${status} case`, () => {
        for (const id of requiredAcceptanceIds) {
            const f = fixture();
            f.evidence.cases.find((c) => c.id === id).status = status;
            assert.throws(() => assertPlatformGate(f), /acceptance_incomplete/);
        }
    });
test('rejects each missing mandatory case and empty evidence', () => {
    for (const id of requiredAcceptanceIds) {
        const f = fixture();
        f.evidence.cases = f.evidence.cases.filter((c) => c.id !== id);
        assert.throws(() => assertPlatformGate(f), /acceptance_incomplete/);
    }
    const f = fixture();
    f.evidence.cases = [];
    assert.throws(() => assertPlatformGate(f), /acceptance_incomplete/);
});
for (const [name, mutate] of Object.entries({
    checksum: (f) => (f.evidence.lockChecksum = digest(9)),
    schema: (f) => (f.evidence.schemaVersion = 2),
    environment: (f) => (f.evidence.environment = 'production'),
    dirty: (f) => (f.actualSources.cms.workingTree = ' M backend/src/app.ts'),
    dirtyEvidence: (f) =>
        (f.verification.launch.source.cms.workingTree = '?? stray.js'),
    stale: (f) => (f.evidence.startedAt = '2026-11-06T00:00:00.000Z'),
    foreignRun: (f) => (f.verification.runId = 'old-run'),
    localScope: (f) => (f.verification.owned.scope = 'local'),
    runtimeCleanup: (f) => (f.verification.runtimeCleanupVerified = false),
    cleanup: (f) => (f.verification.owned.cleanup.processGroups = [123]),
    browserFailure: (f) => (f.verification.launch.passed = false),
    foreignCases: (f) => (f.verification.launch.cases = []),
    matrixImage: (f) =>
        (f.verification.a4.matrix.services[0].imageId = digest(9)),
    staleBuild: (f) =>
        (f.verification.a4.build.images.cms.reference =
            'ghcr.io/owner/cms@' + digest(9)),
    missingProvenance: (f) =>
        (f.verification.a4.build.images.cms.provenanceVerified = false),
    missingPreview: (f) => f.verification.b3.cells.pop(),
    foreignB3Runtime: (f) => (f.verification.b3.ownedRunId = 'other-owned-run'),
    foreignB3Site: (f) => (f.verification.b3.sites[0].siteId = 'external'),
    foundation: (f) =>
        (f.verification.b3.scope = 'local-browser-foundation-not-acceptance'),
    failedPreview: (f) => (f.verification.b3.cells[0].status = 'failed'),
    artifact: (f) =>
        (f.verification.owned.artifacts[0].previewBundleDigest = digest(9)),
    noArtifact: (f) => (f.evidence.cases[0].artifacts = []),
}))
    test(`rejects ${name}`, () => {
        const f = fixture();
        mutate(f);
        assert.throws(() => assertPlatformGate(f));
    });
test('candidate verification executes independent registry pull and signed source verification', () => {
    const f = fixture(),
        calls = [];
    const execute = (command, args) => {
        calls.push([command, ...args]);
        if (command === 'docker' && args[0] === 'image')
            return JSON.stringify([
                {
                    Id: hash(args.at(-1)),
                    RepoDigests: [args.at(-1)],
                    Config: {
                        Labels: {
                            'org.opencontainers.image.revision': 'a'.repeat(40),
                            'org.opencontainers.image.version': args
                                .at(-1)
                                .includes('/aeroframe@')
                                ? '1.0.4'
                                : args.at(-1).includes('/fireguard@')
                                  ? '1.0.1'
                                  : '1.0.0',
                        },
                    },
                },
            ]);
        return 'verified';
    };
    const result = verifyCandidateArtifacts(f.lock, f.candidates, execute);
    assert.equal(Object.keys(result.images).length, 5);
    assert.equal(calls.filter((c) => c[0] === 'gh').length, 5);
    assert.ok(
        calls
            .filter((c) => c[0] === 'gh')
            .every(
                (c) =>
                    c.includes('--source-digest') &&
                    c.includes('a'.repeat(40)) &&
                    c.includes('--signer-workflow'),
            ),
    );
    assert.throws(
        () =>
            verifyCandidateArtifacts(f.lock, f.candidates, () => {
                throw Error('signature rejected');
            }),
        /signature rejected/,
    );
    assert.throws(
        () =>
            verifyCandidateArtifacts(f.lock, f.candidates, (cmd, args) =>
                cmd === 'docker' && args[0] === 'image'
                    ? JSON.stringify([
                          {
                              Id: hash('bad'),
                              RepoDigests: [],
                              Config: { Labels: {} },
                          },
                      ])
                    : '',
            ),
        /artifact/,
    );
});
test('formal preview uses an explicit fresh output directory and never overwrites evidence', async () => {
    const { readFile, writeFile, mkdtemp, mkdir, rm } = await import(
        'node:fs/promises'
    );
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const source = await readFile(
        new URL('../e2e/preview-roundtrip.mjs', import.meta.url),
        'utf8',
    );
    assert.match(source, /E2E_PREVIEW_OUTPUT_DIR/);
    assert.match(source, /await createLaunchDirectory\(output\)/);
    const { createLaunchDirectory } = await import('../e2e/launch-results.mjs');
    const dir = await mkdtemp(path.join(tmpdir(), 'f1-preview-'));
    try {
        const output = path.join(dir, 'output');
        await createLaunchDirectory(output);
        await writeFile(path.join(output, 'proof'), 'retained');
        await assert.rejects(
            createLaunchDirectory(output),
            /fresh run directory/,
        );
        assert.equal(
            await readFile(path.join(output, 'proof'), 'utf8'),
            'retained',
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('retained evidence hashing rejects missing and escaping artifacts', async () => {
    const { hashEvidenceArtifacts } = await import('./verify-platform.mjs');
    const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const directory = await mkdtemp(path.join(tmpdir(), 'f1-artifacts-'));
    try {
        await mkdir(path.join(directory, 'launch'));
        await writeFile(
            path.join(directory, 'launch/proof.json'),
            'actual bytes',
        );
        const result = await hashEvidenceArtifacts(
            ['proof.json'],
            path.join(directory, 'launch'),
            directory,
        );
        assert.equal(result['launch/proof.json'], hash('actual bytes'));
        await assert.rejects(
            hashEvidenceArtifacts(
                ['absent.json'],
                path.join(directory, 'launch'),
                directory,
            ),
        );
        await assert.rejects(
            hashEvidenceArtifacts(
                ['/etc/hosts'],
                path.join(directory, 'launch'),
                directory,
            ),
            /outside_gate/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('a wrong OCI version or image repository cannot satisfy candidate identity', () => {
    const f = fixture();
    f.candidates.services.cms.image = 'ghcr.io/other/cms@' + digest(6);
    assert.throws(
        () => verifyCandidateArtifacts(f.lock, f.candidates, () => ''),
        /candidate_repository/,
    );
});
test('replaying an old gate context or claiming future execution cannot pass', () => {
    const old = fixture();
    old.verification.startedAt = '2020-01-01T00:00:00Z';
    old.verification.completedAt = '2099-01-01T00:00:00Z';
    assert.throws(() => assertPlatformGate(old), /stale_or_future_gate/);
});
test('final verifier reads producer files and rejects substituted B3 cells', async () => {
    const { readPlatformReports } = await import('./verify-platform.mjs');
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const directory = await mkdtemp(path.join(tmpdir(), 'f1-producers-'));
    const f = fixture();
    try {
        for (const name of ['launch/owned', 'a4', 'preview'])
            await mkdir(path.join(directory, name), { recursive: true });
        const save = async (name, value) =>
            writeFile(path.join(directory, name), JSON.stringify(value));
        f.verification.owned.platformPreview = f.verification.b3;
        await save('launch/launch-result.json', f.verification.launch);
        await save('launch/owned/evidence.json', f.verification.owned);
        await save('a4/runtime-isolation.json', f.verification.a4.matrix);
        await save('a4/local-publication.json', f.verification.a4.publication);
        const b3 = f.verification.b3;
        await save('preview/preview-AcceptanceEvidence.json', {
            schemaVersion: b3.schemaVersion,
            lockChecksum: b3.lockChecksum,
            environment: b3.environment,
            startedAt: b3.startedAt,
            completedAt: b3.completedAt,
        });
        for (const id of ['aeroframe', 'fireguard'])
            await save('preview/' + id + '-cells.json', {
                cells: b3.cells.filter((c) => c.templateId === id),
            });
        const result = await readPlatformReports(
            path.join(directory, 'launch'),
        );
        assert.deepEqual(result.launch, f.verification.launch);
        assert.deepEqual(result.b3, b3);
        await save('preview/aeroframe-cells.json', { cells: [] });
        await assert.rejects(
            readPlatformReports(path.join(directory, 'launch')),
            /preview_cells_mismatch/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
