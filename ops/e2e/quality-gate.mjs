import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cmsRoot, gatewayRoot, runtimeDir } from './runtime.mjs';

export function classifyGateFailure({ name, status, stderr = '', stdout = '' }) {
  const output = `${stderr}\n${stdout}`.toLowerCase();
  if (output.includes('enoent') || output.includes('no such file') || output.includes('connection refused') || output.includes('runtime unavailable')) return 'runtime_unavailable';
  if (name.includes('availability') || name.includes('unavailable')) return 'runtime_unavailable';
  if (name.includes('contract')) return 'contract_invalid';
  if (name.includes('template') || name.includes('renderer')) return 'renderer_invalid';
  if (name.includes('artifact')) return 'artifact_invalid';
  return status === null ? 'runtime_unavailable' : 'artifact_invalid';
}

export function buildGateSummary({ checks, metadata }) {
  const failureCodes = [...new Set(checks.filter((check) => !check.passed).map((check) => check.failureCode).filter(Boolean))];
  return {
    passed: checks.every((check) => check.passed),
    checks,
    failureCodes,
    metadata,
  };
}

export function assertActiveStateUnchanged(before, after) {
  assert.deepEqual(after, before, 'active release changed while the quality gate was running');
}

function checksum(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function metadataSnapshot() {
  const releasePath = path.join(runtimeDir, 'runtime-artifact-isolation-check/release.json');
  const bytes = await readFile(releasePath);
  const release = JSON.parse(bytes);
  let manifestChecksum = release.manifestChecksum ?? release.snapshot?.manifestChecksum ?? null;
  const templatesRoot = process.env.E2E_TEMPLATES_ROOT || path.resolve(cmsRoot, '../Independent-Website-Templates');
  const manifestTemplateId = release.templateId === 'aeroframe' || release.templateId === 'fireguard' ? release.templateId : (process.env.TEMPLATE_ID || 'aeroframe');
  const manifestTemplateVersion = release.templateVersion === '1.0.3' || release.templateVersion === '1.0.2' || release.templateVersion === '1.0.1' || release.templateVersion === '1.0.0' ? release.templateVersion : (process.env.TEMPLATE_VERSION || '1.0.3');
  try {
    const manifestBytes = await readFile(path.join(templatesRoot, 'templates', manifestTemplateId, manifestTemplateVersion, 'template.json'));
    const manifest = JSON.parse(manifestBytes);
    const canonical = (value) => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (Array.isArray(value)) return value.map(canonical);
      if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
      throw new Error('manifest contains a non-JSON value');
    };
    manifestChecksum = checksum(Buffer.from(JSON.stringify(canonical(manifest))));
  } catch {
    // The gate result still records the missing checksum; the renderer check will classify the missing template runtime.
  }
  return {
    templateId: release.templateId,
    templateVersion: release.templateVersion,
    contractVersion: release.snapshot?.contractVersion ?? release.snapshot?.schemaVersion ?? null,
    manifestChecksum,
    rendererDigest: release.rendererDigest ?? null,
    releaseChecksum: checksum(bytes),
    releaseId: release.releaseId,
  };
}

async function readActiveState() {
  const statePath = path.join(runtimeDir, 'gateway-routes.json');
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return { releaseId: state.releaseId ?? state.active?.releaseId ?? null, revision: state.revision ?? state.routeRevision ?? null };
  } catch {
    try {
      const release = JSON.parse(await readFile(path.join(runtimeDir, 'runtime-artifact-isolation-check/release.json'), 'utf8'));
      return { releaseId: release.releaseId, revision: release.snapshot?.bindingRevision ?? null };
    } catch {
      return { releaseId: null, revision: null };
    }
  }
}

function runCheck(name, command, env) {
  const startedAt = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: cmsRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const passed = result.status === 0;
  const failureCode = passed ? null : classifyGateFailure({ name, status: result.status, stderr: result.stderr, stdout: result.stdout });
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  return {
    name,
    passed,
    status: result.status,
    durationMs: Date.now() - startedAt,
    failureCode,
    outputTail: output.slice(-800).replaceAll(/(secret|token|password)=\S+/gi, '$1=[redacted]'),
  };
}

export async function runQualityGate({ outputPath = path.join(runtimeDir, 'quality-gate.json') } = {}) {
  const env = {
    ...process.env,
    E2E_GATEWAY_ROOT: process.env.E2E_GATEWAY_ROOT || gatewayRoot,
    E2E_TEMPLATES_ROOT: process.env.E2E_TEMPLATES_ROOT || path.resolve(cmsRoot, '../Independent-Website-Templates'),
  };
  const before = await readActiveState();
  const metadata = await metadataSnapshot();
  const checks = [
    runCheck('cms-contract-snapshot', [process.execPath, '--test', 'backend/test/contract-snapshot.test.mjs'], env),
    runCheck('contract-roundtrip', [process.execPath, 'ops/e2e/test.mjs', 'contract'], env),
    runCheck('renderer-build', ['npm', 'run', 'build', '--prefix', path.join(env.E2E_TEMPLATES_ROOT, 'templates/aeroframe/1.0.3/storefront')], env),
    runCheck('template-contract-runtime', ['npm', 'run', 'test:contract', '--prefix', env.E2E_TEMPLATES_ROOT], env),
    runCheck('template-renderer-contract', [process.execPath, '--test', path.join(env.E2E_TEMPLATES_ROOT, 'templates/aeroframe/1.0.3/storefront/test/render.test.mjs')], env),
    runCheck('artifact-runtime', [process.execPath, 'ops/e2e/test.mjs', 'platform-baseline'], env),
  ];
  const after = await readActiveState();
  const stateUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!stateUnchanged) checks.push({ name: 'active-release-protection', passed: false, status: 1, durationMs: 0, failureCode: 'artifact_invalid', outputTail: 'active release changed after a gate failure' });
  else checks.push({ name: 'active-release-protection', passed: true, status: 0, durationMs: 0, failureCode: null, outputTail: '' });
  if (!checks.every((check) => check.passed)) assertActiveStateUnchanged(before, after);
  const summary = buildGateSummary({ checks, metadata });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const summary = await runQualityGate();
  console.log(`quality-gate: ${summary.passed ? 'PASS' : 'FAIL'} (${summary.failureCodes.join(', ') || 'none'})`);
  if (!summary.passed) process.exitCode = 1;
}
