import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    cmsRoot,
    gatewayRoot,
    runtimeDir,
    readEnv,
    workerEnv,
} from './runtime.mjs';

import {
    validateMatrixEvidence,
    validateLocalPublicationEvidence,
} from './runtime-evidence.mjs';
export { validateMatrixEvidence, validateLocalPublicationEvidence };

export function classifyGateFailure({
    name,
    status,
    stderr = '',
    stdout = '',
}) {
    const output = `${stderr}\n${stdout}`.toLowerCase();
    if (
        output.includes('enoent') ||
        output.includes('no such file') ||
        output.includes('connection refused') ||
        output.includes('runtime unavailable')
    )
        return 'runtime_unavailable';
    if (name.includes('availability') || name.includes('unavailable'))
        return 'runtime_unavailable';
    if (name.includes('contract')) return 'contract_invalid';
    if (name.includes('template') || name.includes('renderer'))
        return 'renderer_invalid';
    if (name.includes('artifact')) return 'artifact_invalid';
    return status === null ? 'runtime_unavailable' : 'artifact_invalid';
}

export function buildGateSummary({ checks, metadata }) {
    if (
        metadata?.scope === 'formal-lock' &&
        metadata.formalLockAccepted !== true
    )
        checks = [
            ...checks,
            {
                name: 'public-chain-acceptance',
                passed: false,
                status: 'blocked',
                failureCode: 'public_chain_unverified',
            },
        ];
    const failureCodes = [
        ...new Set(
            checks
                .filter((check) => !check.passed)
                .map((check) => check.failureCode)
                .filter(Boolean),
        ),
    ];
    return {
        passed: checks.every((check) => check.passed),
        checks,
        failureCodes,
        metadata,
    };
}

export function assertActiveStateUnchanged(before, after) {
    assert.deepEqual(
        after,
        before,
        'active release changed while the quality gate was running',
    );
}

async function readActiveState() {
    const { Pool } = createRequire(path.join(gatewayRoot, 'package.json'))(
        'pg',
    );
    const pool = new Pool({
        connectionString: workerEnv(await readEnv()).DATABASE_URL,
    });
    try {
        return (
            await pool.query(
                'SELECT "siteId", "releaseId", "imageDigest", "routeRevision" FROM "ActiveDeployment" ORDER BY "siteId"',
            )
        ).rows;
    } finally {
        await pool.end();
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
    const passed =
        result.status === 0 && !/# skipped [1-9]/.test(result.stdout || '');
    const failureCode = passed
        ? null
        : classifyGateFailure({
              name,
              status: result.status,
              stderr: result.stderr,
              stdout: result.stdout,
          });
    const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
    return {
        name,
        passed,
        status: result.status,
        durationMs: Date.now() - startedAt,
        failureCode,
        outputTail: output
            .slice(-800)
            .replaceAll(/(secret|token|password)=\S+/gi, '$1=[redacted]'),
    };
}

export async function runQualityGate({
    outputPath = path.join(runtimeDir, 'quality-gate.json'),
} = {}) {
    if (process.env.E2E_GATE_DIR) return runPlatformGate();
    if (process.env.E2E_LOCAL_CANDIDATES !== '1') {
        const summary = buildGateSummary({
            checks: [],
            metadata: {
                scope: 'formal-lock',
                formalLockAccepted: false,
                pending:
                    'B2 matching public-chain evidence and verified PlatformLock identities',
            },
        });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
        return summary;
    }
    const templatesRoot =
        process.env.E2E_TEMPLATES_ROOT ||
        path.resolve(cmsRoot, '../Independent-Website-Templates');
    const env = {
        ...process.env,
        E2E_GATEWAY_ROOT: gatewayRoot,
        E2E_TEMPLATES_ROOT: templatesRoot,
        CMS_CONTRACT_ROOT: cmsRoot,
        GATEWAY_CONTRACT_ROOT: gatewayRoot,
        TEST_BUILT_CONTRACT: '1',
    };
    const before = await readActiveState();
    const build = JSON.parse(
        await readFile(path.join(runtimeDir, 'build-evidence.json'), 'utf8'),
    );
    const templates = JSON.parse((await readEnv()).E2E_TEMPLATES);
    const checks = [
        runCheck(
            'platform-lock-validator',
            [process.execPath, '--test', 'ops/release/platform-lock.test.mjs'],
            env,
        ),
        runCheck(
            'cms-contract-snapshot',
            [
                process.execPath,
                '--test',
                'backend/test/contract-snapshot.test.mjs',
            ],
            env,
        ),
        runCheck(
            'contract-roundtrip',
            [process.execPath, 'ops/e2e/test.mjs', 'contract'],
            env,
        ),
        runCheck(
            'template-contract-runtime',
            ['npm', 'run', 'test:contract', '--prefix', templatesRoot],
            env,
        ),
    ];
    try {
        const matrix = JSON.parse(
            await readFile(
                path.join(runtimeDir, 'runtime-isolation.json'),
                'utf8',
            ),
        );
        validateMatrixEvidence(
            matrix,
            build.repositories,
            templates,
            build.images,
        );
        const publication = JSON.parse(
            await readFile(
                path.join(runtimeDir, 'local-publication.json'),
                'utf8',
            ),
        );
        validateLocalPublicationEvidence(
            publication,
            build.repositories,
            templates,
            build.images,
        );
        checks.push({
            name: 'real-docker-fault-evidence',
            passed: true,
            status: 0,
            failureCode: null,
        });
    } catch (error) {
        checks.push({
            name: 'real-docker-fault-evidence',
            passed: false,
            status: 1,
            failureCode: 'artifact_invalid',
            outputTail: error.message,
        });
    }
    const after = await readActiveState();
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    checks.push({
        name: 'active-release-protection',
        passed: unchanged,
        status: unchanged ? 0 : 1,
        failureCode: unchanged ? null : 'artifact_invalid',
    });
    assertActiveStateUnchanged(before, after);
    const summary = buildGateSummary({
        checks,
        metadata: {
            repositories: build.repositories,
            images: build.images,
            scope: 'local-candidates-only',
            formalLockAccepted: false,
            pending: 'B2 public registry and preview digests',
        },
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
    const summary = await runQualityGate();
    console.log(
        `quality-gate: ${summary.passed ? 'PASS' : 'FAIL'} (${summary.failureCodes.join(', ') || 'none'})`,
    );
    if (!summary.passed) process.exitCode = 1;
}

// F1 composes A4's explicitly supporting local runtime checks with authentic
// public artifacts and the complete D1/B3 results. No local label is promoted.
export async function runPlatformGate(env = process.env) {
    const { randomUUID } = await import('node:crypto');
    const { verifyCandidateArtifacts, verifyPlatformFiles, collectSources } =
        await import('../release/verify-platform.mjs');
    const { validatePlatformLock } = await import(
        '../release/platform-lock.mjs'
    );
    const { saveEnv, compose } = await import('./runtime.mjs');
    const { bootstrapLocal } = await import('./local-bootstrap.mjs');
    const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
    for (const key of [
        'E2E_GATE_DIR',
        'E2E_PLATFORM_LOCK',
        'E2E_CANDIDATES',
        'E2E_GATEWAY_ROOT',
        'E2E_TEMPLATES_ROOT',
        'E2E_PREVIEW_ROOT',
        'E2E_FORMAL_ARTIFACTS',
        'E2E_FORMAL_TLS_CERT',
        'E2E_FORMAL_TLS_KEY',
        'E2E_FORMAL_PLATFORM_DOMAIN',
    ])
        assert.ok(env[key], `${key} required`);
    assert.notEqual(
        env.E2E_LAUNCH_LOCAL,
        '1',
        'Formal gate cannot run local launch',
    );
    assert.notEqual(env.STOREFRONT_E2E_FORMAL_PREVIEW, '0');
    const directory = path.resolve(env.E2E_GATE_DIR);
    assert.equal(
        runtimeDir,
        path.join(directory, 'a4'),
        'E2E_RUNTIME_DIR must be the fresh gate directory /a4',
    );
    await mkdir(directory, { recursive: false });
    const startedAt = new Date().toISOString(),
        runId = randomUUID();
    const lock = validatePlatformLock(await readJSON(env.E2E_PLATFORM_LOCK));
    const roots = {
        cms: cmsRoot,
        gateway: env.E2E_GATEWAY_ROOT,
        templates: env.E2E_TEMPLATES_ROOT,
        preview: env.E2E_PREVIEW_ROOT,
    };
    const source = collectSources(roots);
    for (const [key, value] of Object.entries(source)) {
        assert.equal(
            value.commit,
            lock.repositories[key].commit,
            `source_drift:${key}`,
        );
        assert.equal(value.workingTree, '', `dirty_source:${key}`);
    }
    const candidates = await readJSON(env.E2E_CANDIDATES);
    const build = verifyCandidateArtifacts(lock, candidates);
    const run = (name, args, extra = {}) => {
        const check = runCheck(name, args, { ...env, ...extra });
        // Private logs stay on the isolated runner. Never upload credential-bearing stdout.
        assert.equal(
            check.passed,
            true,
            `${name} failed (${check.failureCode})`,
        );
        return check;
    };
    run('runtime-init', [process.execPath, 'ops/e2e/runtime.mjs', 'init']);
    await writeFile(
        path.join(runtimeDir, 'build-evidence.json'),
        JSON.stringify(build),
    );
    const runtime = await readEnv();
    await saveEnv({
        ...runtime,
        E2E_CMS_IMAGE: candidates.services.cms.image,
        E2E_GATEWAY_IMAGE: candidates.services.gateway.image,
        E2E_PREVIEW_IMAGE: candidates.services.preview.image,
        E2E_TEMPLATES: JSON.stringify(
            lock.templates.map((t) => ({
                id: t.id,
                version: t.version,
                image: candidates.templates.find(
                    (a) => a.id === t.id && a.version === t.version,
                ).image,
            })),
        ),
    });
    let a4,
        runtimeCleanupVerified = false;
    const launchDir = path.join(directory, 'launch');
    const previewDir = path.join(directory, 'preview');
    try {
        run('runtime-up', [process.execPath, 'ops/e2e/runtime.mjs', 'up']);
        run('runtime-migrate', [
            process.execPath,
            'ops/e2e/runtime.mjs',
            'migrate',
        ]);
        await bootstrapLocal();
        run('runtime-up-after-bootstrap', [
            process.execPath,
            'ops/e2e/runtime.mjs',
            'up',
        ]);
        const local = { E2E_LOCAL_CANDIDATES: '1' };
        run(
            'a4-publication',
            [process.execPath, 'ops/e2e/test.mjs', 'publication-control-plane'],
            local,
        );
        run(
            'a4-isolation',
            [process.execPath, 'ops/e2e/runtime-isolation.mjs'],
            local,
        );
        const contracts = {
            CMS_CONTRACT_ROOT: cmsRoot,
            GATEWAY_CONTRACT_ROOT: gatewayRoot,
            TEST_BUILT_CONTRACT: '1',
        };
        run(
            'contract-roundtrip',
            [process.execPath, 'ops/e2e/test.mjs', 'contract'],
            contracts,
        );
        run(
            'template-contract-runtime',
            ['npm', 'run', 'test:contract', '--prefix', env.E2E_TEMPLATES_ROOT],
            contracts,
        );
        a4 = {
            build,
            matrix: await readJSON(
                path.join(runtimeDir, 'runtime-isolation.json'),
            ),
            publication: await readJSON(
                path.join(runtimeDir, 'local-publication.json'),
            ),
        };
        run('d1-launch', [process.execPath, 'ops/e2e/test.mjs', 'launch'], {
            E2E_RUNTIME_DIR: launchDir,
            E2E_DATABASE_ENV_FILE: path.join(runtimeDir, 'runtime.env'),
            E2E_GATE_B3: '1',
            E2E_GATE_B3_OUTPUT_DIR: previewDir,
            E2E_LAUNCH_LOCAL: '0',
            E2E_LOCAL_CANDIDATES: '0',
        });
    } finally {
        compose('down', '--volumes', '--remove-orphans');
        runtimeCleanupVerified = true;
    }
    assert.equal(runtimeCleanupVerified, true);
    const owned = await readJSON(path.join(launchDir, 'owned/evidence.json'));
    const verification = {
        schemaVersion: 1,
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        launch: await readJSON(path.join(launchDir, 'launch-result.json')),
        owned,
        a4,
        b3: owned.platformPreview,
        runtimeCleanupVerified,
    };
    await writeFile(
        path.join(launchDir, 'platform-verification.json'),
        JSON.stringify(verification, null, 2) + '\n',
    );
    const receipt = await verifyPlatformFiles(
        env.E2E_PLATFORM_LOCK,
        path.join(launchDir, 'acceptance-evidence.json'),
        { ...env, E2E_GATE_RUN_ID: runId, E2E_GATE_STARTED_AT: startedAt },
    );
    const summary = {
        passed: true,
        checks: [{ name: 'versioned-platform-acceptance', passed: true }],
        metadata: { scope: 'formal-lock', formalLockAccepted: true, receipt },
    };
    await writeFile(
        path.join(directory, 'quality-gate.json'),
        JSON.stringify(summary, null, 2) + '\n',
    );
    return summary;
}
