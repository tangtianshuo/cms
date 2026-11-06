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
