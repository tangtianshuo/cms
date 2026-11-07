import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    createLaunchDirectory,
    validateLaunchEnvelope,
    finalizeLaunchResults,
} from './launch-results.mjs';
import { validatePlatformLock } from '../release/platform-lock.mjs';
import {
    acceptanceTemplates,
    summarizeAcceptance,
} from './acceptance-report.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function runLaunch(env = process.env) {
    process.umask(0o077);
    const runId =
        new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
    const directory = path.resolve(
        env.E2E_RUNTIME_DIR ||
            path.join(
                root,
                'docs/verification/evidence/platform-delivery',
                runId,
            ),
    );
    await createLaunchDirectory(directory);
    const startedAt = new Date().toISOString();
    let lock,
        lockChecksum = null,
        reason,
        cases = [];
    try {
        const bytes = await readFile(
            env.E2E_PLATFORM_LOCK ||
                path.join(root, 'docs/releases/platform-lock.json'),
        );
        lock = validatePlatformLock(JSON.parse(bytes));
        for (const template of acceptanceTemplates)
            if (
                !lock.templates.some(
                    (t) =>
                        t.id === template.id && t.version === template.version,
                )
            )
                throw Error('Required template identities absent');
        lockChecksum =
            'sha256:' + createHash('sha256').update(bytes).digest('hex');
    } catch {
        reason =
            'Genuine complete PlatformLock and immutable public template/preview artifacts required; no local identity substitution';
    }
    const source = {};
    for (const [name, directory] of Object.entries({
        cms: root,
        gateway: env.E2E_GATEWAY_ROOT,
        templates: env.E2E_TEMPLATES_ROOT,
        preview: env.E2E_PREVIEW_ROOT,
    }))
        if (directory) {
            try {
                source[name] = {
                    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
                        cwd: directory,
                        encoding: 'utf8',
                    }).trim(),
                    diffChecksum:
                        'sha256:' +
                        createHash('sha256')
                            .update(
                                execFileSync('git', ['diff', 'HEAD', '--'], {
                                    cwd: directory,
                                }),
                            )
                            .digest('hex'),
                    workingTree: execFileSync(
                        'git',
                        ['status', '--porcelain', '--untracked-files=all'],
                        { cwd: directory, encoding: 'utf8' },
                    ).trim(),
                };
            } catch {
                source[name] = { unavailable: true };
            }
        }
    let childStatus,
        supplementary,
        ownedReceipt,
        cleanupVerified = false;
    if (env.E2E_LAUNCH_LOCAL === '1') {
        const run = spawnSync(
            process.execPath,
            ['ops/e2e/site-provisioning.mjs'],
            {
                cwd: root,
                env: {
                    ...env,
                    E2E_C4_MODE: 'local',
                    E2E_D1_LOCAL: '1',
                    E2E_RUNTIME_DIR: path.join(directory, 'local'),
                },
                stdio: 'inherit',
            },
        );
        supplementary = {
            scope: 'source-bound-local-not-formal-acceptance',
            exitCode: run.status,
            evidence: 'local/evidence.json',
        };
    }
    if (!reason) {
        for (const name of ['cms', 'gateway', 'templates', 'preview'])
            if (
                source[name]?.commit !== lock.repositories[name].commit ||
                source[name]?.workingTree
            )
                reason =
                    'All four executed sources must be clean and match the supplied PlatformLock';
    }
    if (reason)
        cases = acceptanceTemplates.map((t) => ({
            id: t.id + '/CREATE',
            status: 'blocked',
            reason,
            artifacts: ['launch-result.json'],
        }));
    else {
        const browser = spawnSync(
            process.execPath,
            ['ops/e2e/launch-owned.mjs'],
            {
                cwd: root,
                env: {
                    ...env,
                    E2E_RUNTIME_DIR: path.join(directory, 'owned'),
                    E2E_PLATFORM_LOCK:
                        env.E2E_PLATFORM_LOCK ||
                        path.join(root, 'docs/releases/platform-lock.json'),
                    STOREFRONT_E2E_LAUNCH: '1',
                    STOREFRONT_E2E_LAUNCH_LOCAL: '0',
                    STOREFRONT_E2E_RUN_ID: runId,
                    STOREFRONT_E2E_LOCK_CHECKSUM: lockChecksum,
                    STOREFRONT_E2E_LAUNCH_RESULTS: path.join(
                        directory,
                        'cases',
                    ),
                    STOREFRONT_E2E_RESULTS_DIR: path.join(directory, 'browser'),
                    STOREFRONT_E2E_PRIVATE_DIR: path.join(directory, 'private'),
                },
                stdio: 'inherit',
            },
        );
        childStatus = browser.status;
        try {
            ownedReceipt = JSON.parse(
                await readFile(
                    path.join(directory, 'owned/evidence.json'),
                    'utf8',
                ),
            );
            if (
                ownedReceipt.runId !== runId ||
                ownedReceipt.lockChecksum !== lockChecksum ||
                ownedReceipt.scope !== 'formal-owned-runtime'
            )
                throw Error('Foreign lifecycle');
            cleanupVerified = ownedReceipt.cleanupVerified === true;
        } catch {
            cleanupVerified = false;
        }
        for (const template of acceptanceTemplates)
            try {
                const result = JSON.parse(
                    await readFile(
                        path.join(directory, 'cases', template.id + '.json'),
                        'utf8',
                    ),
                );
                const operational = (ownedReceipt?.cases || []).filter((c) =>
                    c.id.startsWith(template.id + '/'),
                );
                const replacements = new Set(operational.map((c) => c.id));
                cases.push(
                    ...validateLaunchEnvelope(result, {
                        runId,
                        lockChecksum,
                        target: template,
                        scope: 'formal-UI',
                    }).filter((c) => !replacements.has(c.id)),
                    ...operational,
                );
            } catch {
                cases.push({
                    id: template.id + '/CREATE',
                    status: 'blocked',
                    reason: 'Browser did not produce a result; inspect runtime readiness and safe evidence',
                    artifacts: [],
                });
            }
    }
    const finalized = finalizeLaunchResults({
        cases,
        lockChecksum,
        browserExit: childStatus,
        cleanupVerified,
        startedAt,
    });
    const completed = finalized.cases,
        summary = summarizeAcceptance(completed);
    const report = {
        schemaVersion: 1,
        evidenceType: lockChecksum
            ? 'lock-bound-launch-results'
            : 'blocked-launch-not-AcceptanceEvidence',
        runId,
        lockChecksum,
        startedAt,
        completedAt: new Date().toISOString(),
        source,
        supplementary,
        cleanupVerified,
        ...summary,
        passed: summary.passed && childStatus === 0,
        cases: completed,
        formalGate: reason || null,
    };
    await writeFile(
        path.join(directory, 'launch-result.json'),
        JSON.stringify(report, null, 2) + '\n',
        { mode: 0o600 },
    );
    if (finalized.consumerEvidence)
        await writeFile(
            path.join(directory, 'acceptance-evidence.json'),
            JSON.stringify(finalized.consumerEvidence, null, 2) + '\n',
            { mode: 0o600 },
        );
    console.log(
        `launch: ${report.passed ? 'PASS' : 'NOT PASSED'}; ${summary.failed.length} failed, ${summary.blocked.length} blocked, ${summary.notRun.length} not-run. ${path.join(directory, 'launch-result.json')}`,
    );
    return report;
}
