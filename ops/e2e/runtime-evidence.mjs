import assert from 'node:assert/strict';

export function assertCleanupComplete(cleanup) {
    assert.deepEqual(
        cleanup,
        {
            childProcessesRemaining: [],
            servicesStopped: [],
            errors: [],
        },
        'runtime evidence cleanup incomplete',
    );
}

export function finalizeRuntimeEvidence(report, checksPassed, cleanup) {
    let cleanupPassed = true;
    try {
        assertCleanupComplete(cleanup);
    } catch {
        cleanupPassed = false;
    }
    return {
        ...report,
        cleanup,
        completedAt: new Date().toISOString(),
        passed: checksPassed === true && cleanupPassed,
    };
}

function validateRuntimeEvidence(evidence, repositories, templates, images) {
    assert.equal(evidence.evidenceType, 'isolated-local-candidate');
    assert.equal(evidence.passed, true, 'runtime evidence must have passed');
    assert.deepEqual(
        evidence.sourceIdentities,
        repositories,
        'runtime evidence source identities are stale',
    );
    assertCleanupComplete(evidence.cleanup);
    assert.ok(
        Array.isArray(evidence.services),
        'runtime image records missing',
    );
    function serviceImage(kind, imageKey) {
        const expected = images?.[imageKey]?.imageId;
        assert.match(
            expected || '',
            /^sha256:[a-f0-9]{64}$/,
            `build image missing: ${imageKey}`,
        );
        const records = evidence.services.filter(
            (service) => service.kind === kind,
        );
        assert.equal(
            records.length,
            1,
            `runtime image record missing or ambiguous: ${kind}`,
        );
        assert.equal(
            records[0].imageId,
            expected,
            `runtime image mismatch: ${kind}`,
        );
        return { record: records[0], expected };
    }
    serviceImage('cms', 'cms');
    serviceImage('gateway-control', 'gateway');
    serviceImage('gateway-ingest', 'gateway');
    for (const template of templates) {
        const kind = `${template.id}@${template.version}`;
        const { record, expected } = serviceImage(
            kind,
            `${template.id}-${template.version}`,
        );
        for (const field of ['configuredImage', 'authoritativeImage'])
            assert.equal(
                record[field],
                expected,
                `runtime ${field} mismatch: ${kind}`,
            );
        assert.equal(
            record.active?.imageDigest,
            expected,
            `runtime active image mismatch: ${kind}`,
        );
    }
}

function assertCases(evidence, templates, scenarios) {
    assert.ok(Array.isArray(evidence.cases), 'runtime cases missing');
    for (const template of templates)
        for (const scenario of scenarios) {
            const id = `${template.id}@${template.version}:${scenario}`;
            const cases = evidence.cases.filter((item) => item.id === id);
            assert.equal(
                cases.length,
                1,
                `required runtime case missing or ambiguous: ${id}`,
            );
            assert.equal(
                cases[0].status,
                'passed',
                `required runtime case failed: ${id}`,
            );
        }
}

export function validateMatrixEvidence(
    matrix,
    repositories,
    templates,
    images,
) {
    validateRuntimeEvidence(matrix, repositories, templates, images);
    assertCases(matrix, templates, [
        'cms-stopped',
        'gateway-control-stopped',
        'worker-stopped',
        'gateway-ingest-stopped',
    ]);
}

export function validateLocalPublicationEvidence(
    publication,
    repositories,
    templates,
    images,
) {
    validateRuntimeEvidence(publication, repositories, templates, images);
    assertCases(publication, templates, [
        'draft-isolation-publish-rollback',
        'real-local-publish-idempotency-stale-rejection',
        'artifact-integrity-failure',
        'worker-restart-recovery',
    ]);
}
