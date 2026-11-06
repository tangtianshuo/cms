import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    classifyGateFailure,
    buildGateSummary,
    assertActiveStateUnchanged,
} from './quality-gate.mjs';

test('classifies gate failures into stable release categories', () => {
    assert.equal(
        classifyGateFailure({ name: 'contract-roundtrip', status: 1 }),
        'contract_invalid',
    );
    assert.equal(
        classifyGateFailure({ name: 'template-runtime', status: 1 }),
        'renderer_invalid',
    );
    assert.equal(
        classifyGateFailure({ name: 'artifact-runtime', status: 1 }),
        'artifact_invalid',
    );
    assert.equal(
        classifyGateFailure({ name: 'runtime-availability', status: 1 }),
        'runtime_unavailable',
    );
});

test('gate summary fails closed and preserves release metadata', () => {
    const summary = buildGateSummary({
        checks: [
            { name: 'contract-roundtrip', passed: true },
            {
                name: 'template-runtime',
                passed: false,
                failureCode: 'renderer_invalid',
            },
        ],
        metadata: {
            manifestChecksum: 'sha256:manifest',
            rendererDigest: 'sha256:renderer',
            releaseChecksum: 'sha256:release',
        },
    });
    assert.equal(summary.passed, false);
    assert.deepEqual(summary.failureCodes, ['renderer_invalid']);
    assert.equal(summary.metadata.releaseChecksum, 'sha256:release');
});

test('active release state must not change when a gate fails', () => {
    assert.doesNotThrow(() =>
        assertActiveStateUnchanged(
            { releaseId: 'old', revision: 3 },
            { releaseId: 'old', revision: 3 },
        ),
    );
    assert.throws(
        () =>
            assertActiveStateUnchanged(
                { releaseId: 'old', revision: 3 },
                { releaseId: 'new', revision: 4 },
            ),
        /active release changed/i,
    );
});

function evidenceFixture() {
    const repositories = Object.fromEntries(
        ['cms', 'gateway', 'templates', 'preview'].map((name, index) => [
            name,
            {
                repository: `owner/${name}`,
                commit: String(index + 1).repeat(40),
            },
        ]),
    );
    const templates = [
        { id: 'aeroframe', version: '1.0.4' },
        { id: 'fireguard', version: '1.0.1' },
    ];
    const images = Object.fromEntries(
        ['cms', 'gateway', 'preview', 'aeroframe-1.0.4', 'fireguard-1.0.1'].map(
            (name, index) => [
                name,
                { imageId: `sha256:${String(index + 1).repeat(64)}` },
            ],
        ),
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
        cleanup: {
            childProcessesRemaining: [],
            servicesStopped: [],
            errors: [],
        },
    };
    const matrix = {
        ...structuredClone(common),
        cases: templates.flatMap((t) =>
            ['cms', 'gateway-control', 'worker', 'gateway-ingest'].map(
                (service) => ({
                    id: `${t.id}@${t.version}:${service}-stopped`,
                    status: 'passed',
                }),
            ),
        ),
    };
    const publication = {
        ...structuredClone(common),
        cases: templates.flatMap((t) =>
            [
                'draft-isolation-publish-rollback',
                'real-local-publish-idempotency-stale-rejection',
                'artifact-integrity-failure',
                'worker-restart-recovery',
            ].map((scenario) => ({
                id: `${t.id}@${t.version}:${scenario}`,
                status: 'passed',
            })),
        ),
    };
    return { repositories, templates, images, matrix, publication };
}

test('matrix gate requires all faults, exact source and actual runtime image identities', async () => {
    const { validateMatrixEvidence } = await import('./quality-gate.mjs');
    const f = evidenceFixture();
    const validate = (matrix) =>
        validateMatrixEvidence(matrix, f.repositories, f.templates, f.images);
    assert.doesNotThrow(() => validate(f.matrix));
    for (const kind of [
        'cms',
        'gateway-control',
        'gateway-ingest',
        'aeroframe@1.0.4',
        'fireguard@1.0.1',
    ]) {
        const matrix = structuredClone(f.matrix);
        matrix.services.find((s) => s.kind === kind).imageId =
            `sha256:${'f'.repeat(64)}`;
        assert.throws(() => validate(matrix), /image/i, kind);
    }
    for (const field of ['configuredImage', 'authoritativeImage']) {
        const matrix = structuredClone(f.matrix);
        matrix.services.find((s) => s.kind === 'aeroframe@1.0.4')[field] =
            `sha256:${'f'.repeat(64)}`;
        assert.throws(() => validate(matrix), /image/i);
    }
    const activeMismatch = structuredClone(f.matrix);
    activeMismatch.services.find(
        (s) => s.kind === 'aeroframe@1.0.4',
    ).active.imageDigest = `sha256:${'f'.repeat(64)}`;
    assert.throws(() => validate(activeMismatch), /image/i);
    const missingImage = structuredClone(f.matrix);
    delete missingImage.services[0].imageId;
    assert.throws(() => validate(missingImage), /image/i);
    assert.throws(
        () => validateMatrixEvidence(f.matrix, f.repositories, f.templates, {}),
        /image/i,
    );
    assert.throws(() =>
        validate({ ...f.matrix, cases: f.matrix.cases.slice(1) }),
    );
    assert.throws(() => validate({ ...f.matrix, passed: false }));
    assert.throws(() => validate({ ...f.matrix, sourceIdentities: {} }));
    assert.throws(() => validate({ ...f.matrix, services: [] }));
});

test('publication gate rejects missing failed or unfinished cleanup even when passed is true', async () => {
    const { validateLocalPublicationEvidence } = await import(
        './quality-gate.mjs'
    );
    const f = evidenceFixture();
    const validate = (publication) =>
        validateLocalPublicationEvidence(
            publication,
            f.repositories,
            f.templates,
            f.images,
        );
    assert.doesNotThrow(() => validate(f.publication));
    for (const cleanup of [
        undefined,
        { errors: [] },
        {
            childProcessesRemaining: [],
            servicesStopped: [],
            errors: ['restore failed'],
        },
        { childProcessesRemaining: [42], servicesStopped: [], errors: [] },
        { childProcessesRemaining: [], servicesStopped: ['cms'], errors: [] },
    ])
        assert.throws(
            () => validate({ ...f.publication, cleanup }),
            /cleanup/i,
        );
    for (const required of f.publication.cases) {
        assert.throws(
            () =>
                validate({
                    ...f.publication,
                    cases: f.publication.cases.filter(
                        (c) => c.id !== required.id,
                    ),
                }),
            /case/i,
        );
        assert.throws(
            () =>
                validate({
                    ...f.publication,
                    cases: f.publication.cases.map((c) =>
                        c.id === required.id ? { ...c, status: 'failed' } : c,
                    ),
                }),
            /case/i,
        );
    }
    const differentImage = structuredClone(f.publication);
    differentImage.services[0].imageId = `sha256:${'f'.repeat(64)}`;
    assert.throws(() => validate(differentImage), /image/i);
});

test('producer marks evidence failed if cleanup fails after successful scenarios', async () => {
    const { finalizeRuntimeEvidence } = await import('./runtime-evidence.mjs');
    const cleanup = {
        childProcessesRemaining: [],
        servicesStopped: [],
        errors: [],
    };
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, true, cleanup).passed,
        true,
    );
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, true, {
            ...cleanup,
            errors: ['stop failed'],
        }).passed,
        false,
    );
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, false, cleanup).passed,
        false,
    );
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, true, undefined).passed,
        false,
    );
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, true, {
            ...cleanup,
            childProcessesRemaining: [42],
        }).passed,
        false,
    );
    assert.equal(
        finalizeRuntimeEvidence({ passed: true }, true, {
            ...cleanup,
            servicesStopped: ['cms'],
        }).passed,
        false,
    );
});

test('formal quality gate cannot accept local proof plus a well-shaped lock', async () => {
    const { runQualityGate } = await import('./quality-gate.mjs');
    const { validatePlatformLock } = await import(
        '../release/platform-lock.mjs'
    );
    const { mkdtemp, writeFile, readFile, rm } = await import(
        'node:fs/promises'
    );
    const path = await import('node:path');
    const f = evidenceFixture();
    const dir = await mkdtemp(path.join(tmpdir(), 'formal-gate-test-'));
    const lock = {
        schemaVersion: 1,
        contractVersion: 1,
        repositories: f.repositories,
        templates: f.templates.map((t) => ({
            ...t,
            manifestChecksum: `sha256:${'1'.repeat(64)}`,
            imageDigest: `sha256:${'2'.repeat(64)}`,
            previewArtifactDigest: `sha256:${'3'.repeat(64)}`,
            previewBundleDigest: `sha256:${'4'.repeat(64)}`,
        })),
    };
    validatePlatformLock(lock);
    const previous = {
        local: process.env.E2E_LOCAL_CANDIDATES,
        lock: process.env.E2E_PLATFORM_LOCK,
    };
    try {
        delete process.env.E2E_LOCAL_CANDIDATES;
        process.env.E2E_PLATFORM_LOCK = path.join(dir, 'platform-lock.json');
        await writeFile(process.env.E2E_PLATFORM_LOCK, JSON.stringify(lock));
        await writeFile(
            path.join(dir, 'local-publication.json'),
            JSON.stringify(f.publication),
        );
        const outputPath = path.join(dir, 'quality-gate.json');
        const result = await runQualityGate({ outputPath });
        assert.equal(result.passed, false);
        assert.equal(result.metadata.formalLockAccepted, false);
        assert.ok(
            result.checks.some(
                (c) => c.status === 'blocked' && /public/i.test(c.name),
            ),
        );
        assert.equal(
            JSON.parse(await readFile(outputPath, 'utf8')).passed,
            false,
        );
        const cli = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('./quality-gate.mjs', import.meta.url))],
            { env: { ...process.env, E2E_RUNTIME_DIR: dir }, encoding: 'utf8' },
        );
        assert.equal(cli.status, 1);
        assert.match(cli.stdout, /quality-gate: FAIL.*public_chain_unverified/);
        assert.equal(
            JSON.parse(await readFile(outputPath, 'utf8')).checks[0].status,
            'blocked',
        );
    } finally {
        if (previous.local === undefined)
            delete process.env.E2E_LOCAL_CANDIDATES;
        else process.env.E2E_LOCAL_CANDIDATES = previous.local;
        if (previous.lock === undefined) delete process.env.E2E_PLATFORM_LOCK;
        else process.env.E2E_PLATFORM_LOCK = previous.lock;
        await rm(dir, { recursive: true, force: true });
    }
});

test('formal summary rejects successful local checks and successful lock-format check', () => {
    const result = buildGateSummary({
        checks: [
            {
                name: 'real-docker-fault-evidence',
                passed: true,
                evidenceType: 'isolated-local-candidate',
            },
            { name: 'formal-platform-lock', passed: true },
        ],
        metadata: { scope: 'formal-lock', formalLockAccepted: false },
    });
    assert.equal(result.passed, false);
});
