import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cmsRoot, compose, readEnv, runtimeDir } from './runtime.mjs';

export const BASELINE_PATHS = [
  '/',
  '/api/published?path=/',
  '/_assets/media/logo.txt',
  '/sitemap.xml',
  '/api/published?path=/legacy-home',
];

export function classifyProbeFailure({ status, error } = {}) {
  if (error?.code === 'ECONNREFUSED') return 'connection_refused';
  if (error?.code === 'ETIMEDOUT' || error?.name === 'AbortError') return 'timeout';
  if (typeof status === 'number' && status >= 500) return 'upstream_unavailable';
  if (typeof status === 'number' && status >= 400) return `http_${status}`;
  return null;
}

export function createProbeRecord({ path: pathname, status = null, durationMs = null, errorCode = null, cmsOutbound = false }) {
  return { path: pathname, status, durationMs, errorCode, cmsOutbound: Boolean(cmsOutbound) };
}

export function createScenarioRecord({ name, services, probes, artifactAvailable, notes = [] }) {
  return {
    name,
    services,
    artifactAvailable: Boolean(artifactAvailable),
    probes,
    notes,
  };
}

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: cmsRoot,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function dockerLogs(container) {
  try {
    return docker(['logs', container]);
  } catch {
    return '';
  }
}

function serviceState(container) {
  try {
    const raw = docker(['inspect', '--format', '{{.State.Status}}', container]).trim();
    return raw || 'unknown';
  } catch {
    return 'missing';
  }
}

async function probeArtifact(port, pathname, secret, cmsLogsBefore) {
  const result = spawnSync('curl', [
    '-sS', '--max-time', '10', '-o', '/dev/null',
    '-w', '%{http_code}\t%{time_total}',
    '-H', 'Host: builtin.localhost',
    '-H', 'x-storefront-host: builtin.localhost',
    '-H', `x-storefront-key: ${secret}`,
    `http://127.0.0.1:${port}${pathname}`,
  ], { encoding: 'utf8' });
  const [statusText, secondsText] = (result.stdout || '').trim().split('\t');
  const status = statusText ? Number(statusText) : null;
  const durationMs = secondsText ? Math.round(Number(secondsText) * 1000) : null;
  const error = result.status === 0 ? null : { code: result.error?.code || (result.signal === 'SIGTERM' ? 'ETIMEDOUT' : 'ECONNREFUSED') };
  if (result.status !== 0 && process.env.PLATFORM_BASELINE_DEBUG === '1') {
    console.error('platform probe curl failed', { pathname, status: result.status, signal: result.signal, stderr: result.stderr, error: result.error });
  }
  const cmsOutbound = dockerLogs('cms-e2e-20261028-cms-1').slice(cmsLogsBefore.length).includes('/api/v4/storefront/published');
  return createProbeRecord({
    path: pathname,
    status,
    durationMs,
    errorCode: classifyProbeFailure({ status, error }),
    cmsOutbound,
  });
}

async function waitForArtifact(port, secret) {
  const deadline = Date.now() + 30000;
  let last;
  while (Date.now() < deadline) {
    const probe = await probeArtifact(port, '/', secret, '');
    if (probe.status && probe.status > 0) return;
    last = probe;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`artifact storefront did not become ready: ${JSON.stringify(last)}`);
}

function safeWorkerPid() {
  try {
    const pid = Number(execFileSync('cat', [path.join(runtimeDir, 'worker.pid')], { encoding: 'utf8' }).trim());
    if (!Number.isInteger(pid) || pid <= 1) return null;
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    return command.includes('packages/worker') ? pid : null;
  } catch {
    return null;
  }
}

async function runScenario({ name, port, secret, services, workerAction }) {
  const before = dockerLogs('cms-e2e-20261028-cms-1');
  const notes = [];
  let cleanupWorker = null;
  if (workerAction) cleanupWorker = await workerAction(notes);
  const probes = [];
  try {
    for (const pathname of BASELINE_PATHS) probes.push(await probeArtifact(port, pathname, secret, before));
  } finally {
    if (cleanupWorker) await cleanupWorker();
  }
  return createScenarioRecord({
    name,
    services,
    probes,
    artifactAvailable: probes.every((probe) => probe.status === 200),
    notes,
  });
}

export async function collectPlatformBaseline({ outputPath = path.join(runtimeDir, 'platform-baseline.json') } = {}) {
  const env = await readEnv();
  const artifactRoot = path.join(runtimeDir, 'runtime-artifact-isolation-check');
  const release = JSON.parse(await readFile(path.join(artifactRoot, 'release.json'), 'utf8'));
  await access(path.join(artifactRoot, 'assets/media/logo.txt'));
  const container = 'cms-e2e-platform-baseline';
  const port = 13003;
  const secret = env.E2E_STOREFRONT_SECRET;
  try { docker(['rm', '-f', container]); } catch { /* already absent */ }
  docker([
    'run', '-d', '--name', container, '--network', 'bridge', '-p', `${port}:3000`,
    '-e', 'NODE_ENV=production', '-e', 'NUXT_DOMAIN_PRODUCTION=false',
    '-e', 'NUXT_RUNTIME_ARTIFACT_ROOT=/var/lib/runtime',
    '-e', `NUXT_RUNTIME_RELEASE_ID=${release.releaseId}`,
    '-e', 'NUXT_LEGACY_CMS_PUBLIC_READ=false',
    '-e', 'NUXT_PUBLIC_SITE_HOST=builtin.localhost',
    '-e', `NUXT_GATEWAY_SECRET=${secret}`,
    '-e', `NUXT_DOMAIN_SECRET=${env.E2E_DOMAIN_SECRET}`,
    '-v', `${artifactRoot}:/var/lib/runtime:ro`, 'local/cms-storefront-e2e:20261028',
  ]);
  try {
    await waitForArtifact(port, secret);
    const scenarios = [];
    scenarios.push(await runScenario({
      name: 'healthy',
      port,
      secret,
      services: {
        cms: serviceState('cms-e2e-20261028-cms-1'),
        gatewayControl: serviceState('cms-e2e-20261028-gateway-control-1'),
        worker: safeWorkerPid() ? 'running' : 'not-running',
        storefront: serviceState(container),
      },
    }));

    compose('stop', 'cms');
    scenarios.push(await runScenario({
      name: 'cms-stopped',
      port,
      secret,
      services: { cms: 'exited', gatewayControl: serviceState('cms-e2e-20261028-gateway-control-1'), worker: safeWorkerPid() ? 'running' : 'not-running', storefront: serviceState(container) },
    }));
    compose('start', 'cms');

    compose('stop', 'gateway-control');
    scenarios.push(await runScenario({
      name: 'gateway-control-stopped',
      port,
      secret,
      services: { cms: serviceState('cms-e2e-20261028-cms-1'), gatewayControl: 'exited', worker: safeWorkerPid() ? 'running' : 'not-running', storefront: serviceState(container) },
    }));
    compose('start', 'gateway-control');

    const pid = safeWorkerPid();
    scenarios.push(await runScenario({
      name: 'worker-stopped',
      port,
      secret,
      services: { cms: serviceState('cms-e2e-20261028-cms-1'), gatewayControl: serviceState('cms-e2e-20261028-gateway-control-1'), worker: pid ? 'stopped' : 'not-running', storefront: serviceState(container) },
      workerAction: async (notes) => {
        if (!pid) {
          notes.push('worker.pid was absent or did not identify the Gateway worker; artifact probe still executed');
          return;
        }
        process.kill(pid, 'SIGSTOP');
        notes.push('worker was stopped while public artifact probes executed');
        return async () => process.kill(pid, 'SIGCONT');
      },
    }));

    scenarios.push(await runScenario({
      name: 'network-isolated-storefront',
      port,
      secret,
      services: { cms: serviceState('cms-e2e-20261028-cms-1'), gatewayControl: serviceState('cms-e2e-20261028-gateway-control-1'), worker: safeWorkerPid() ? 'running' : 'not-running', storefront: serviceState(container) },
      workerAction: async (notes) => {
        notes.push('storefront container runs on Docker bridge network with artifact mounted read-only');
      },
    }));

    const document = {
      generatedAt: new Date().toISOString(),
      releaseId: release.releaseId,
      artifactRoot,
      publicPaths: BASELINE_PATHS,
      scenarios,
      acceptance: {
        publicArtifactRequestsRemainIndependent: scenarios.filter((scenario) => scenario.name !== 'healthy').every((scenario) => scenario.artifactAvailable),
        cmsOutboundObserved: scenarios.some((scenario) => scenario.probes.some((probe) => probe.cmsOutbound)),
        hasFailureCodes: scenarios.every((scenario) => scenario.probes.every((probe) => probe.status === 200 || probe.errorCode)),
      },
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
    return document;
  } finally {
    try { compose('start', 'gateway-control'); } catch { /* report in next run */ }
    try { compose('start', 'cms'); } catch { /* report in next run */ }
    if (process.env.PLATFORM_BASELINE_KEEP_CONTAINER !== '1') {
      try { docker(['rm', '-f', container]); } catch { /* already absent */ }
    }
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const document = await collectPlatformBaseline();
  assert.equal(document.acceptance.publicArtifactRequestsRemainIndependent, true, JSON.stringify(document));
  assert.equal(document.acceptance.hasFailureCodes, true, JSON.stringify(document));
  console.log(`platform baseline: ${path.join(runtimeDir, 'platform-baseline.json')}`);
}
