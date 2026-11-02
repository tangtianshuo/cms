import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGateFailure, buildGateSummary, assertActiveStateUnchanged } from './quality-gate.mjs';

test('classifies gate failures into stable release categories', () => {
  assert.equal(classifyGateFailure({ name: 'contract-roundtrip', status: 1 }), 'contract_invalid');
  assert.equal(classifyGateFailure({ name: 'template-runtime', status: 1 }), 'renderer_invalid');
  assert.equal(classifyGateFailure({ name: 'artifact-runtime', status: 1 }), 'artifact_invalid');
  assert.equal(classifyGateFailure({ name: 'runtime-availability', status: 1 }), 'runtime_unavailable');
});

test('gate summary fails closed and preserves release metadata', () => {
  const summary = buildGateSummary({
    checks: [
      { name: 'contract-roundtrip', passed: true },
      { name: 'template-runtime', passed: false, failureCode: 'renderer_invalid' },
    ],
    metadata: { manifestChecksum: 'sha256:manifest', rendererDigest: 'sha256:renderer', releaseChecksum: 'sha256:release' },
  });
  assert.equal(summary.passed, false);
  assert.deepEqual(summary.failureCodes, ['renderer_invalid']);
  assert.equal(summary.metadata.releaseChecksum, 'sha256:release');
});

test('active release state must not change when a gate fails', () => {
  assert.doesNotThrow(() => assertActiveStateUnchanged({ releaseId: 'old', revision: 3 }, { releaseId: 'old', revision: 3 }));
  assert.throws(() => assertActiveStateUnchanged({ releaseId: 'old', revision: 3 }, { releaseId: 'new', revision: 4 }), /active release changed/i);
});
