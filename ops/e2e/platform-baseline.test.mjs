import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbeFailure, createProbeRecord, createScenarioRecord } from './platform-baseline.mjs';

test('records successful probe with latency and no outbound CMS request', () => {
  const record = createProbeRecord({
    path: '/',
    status: 200,
    durationMs: 12,
    errorCode: null,
    cmsOutbound: false,
  });
  assert.deepEqual(record, {
    path: '/',
    status: 200,
    durationMs: 12,
    errorCode: null,
    cmsOutbound: false,
  });
});

test('classifies transport failures separately from HTTP failures', () => {
  assert.equal(classifyProbeFailure({ status: 502 }), 'upstream_unavailable');
  assert.equal(classifyProbeFailure({ status: 404 }), 'http_404');
  assert.equal(classifyProbeFailure({ error: { code: 'ECONNREFUSED' } }), 'connection_refused');
});

test('scenario record includes service state and artifact impact', () => {
  const record = createScenarioRecord({
    name: 'cms-stopped',
    services: { cms: 'stopped', gatewayControl: 'running', worker: 'running' },
    probes: [{ path: '/', status: 200, durationMs: 10, errorCode: null, cmsOutbound: false }],
    artifactAvailable: true,
  });
  assert.equal(record.name, 'cms-stopped');
  assert.equal(record.artifactAvailable, true);
  assert.equal(record.probes[0].status, 200);
  assert.equal(record.services.cms, 'stopped');
});
