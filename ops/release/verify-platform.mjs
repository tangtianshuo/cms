import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePlatformLock } from './platform-lock.mjs';
import {
    completeAcceptance,
    acceptanceTemplates,
} from '../e2e/acceptance-report.mjs';
import { summarizePreview } from '../e2e/preview-acceptance.mjs';
import {
    validateMatrixEvidence,
    validateLocalPublicationEvidence,
} from '../e2e/runtime-evidence.mjs';
export const checksum = (bytes) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex');
const keys = ['cms', 'gateway', 'templates', 'preview'];
const digest = /^sha256:[a-f0-9]{64}$/;
const emptyDiff = checksum('');
const requireValue = (condition, message) => {
    if (!condition) throw Error(message);
};
function currentWindow(value, context) {
    const start = Date.parse(value?.startedAt),
        end = Date.parse(value?.completedAt);
    requireValue(
        Number.isFinite(start) &&
            Number.isFinite(end) &&
            start <= end &&
            start >= Date.parse(context.startedAt) &&
            end <= Date.parse(context.completedAt),
        'stale_or_invalid_evidence_time',
    );
}
function candidateEntries(lock, candidates) {
    requireValue(candidates?.schemaVersion === 1, 'candidate_schema');
    const entries = ['cms', 'gateway', 'preview'].map((key) => {
        const item = candidates.services?.[key];
        requireValue(
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
                item?.version || '',
            ),
            'candidate_version',
        );
        return { ...item, key, repo: key };
    });
    requireValue(
        Array.isArray(candidates.templates) &&
            candidates.templates.length === lock.templates.length,
        'candidate_templates',
    );
    for (const target of lock.templates) {
        const records = candidates.templates.filter(
            (t) => t.id === target.id && t.version === target.version,
        );
        requireValue(
            records.length === 1 &&
                records[0].image?.endsWith('@' + target.imageDigest),
            'candidate_template_digest',
        );
        entries.push({
            ...records[0],
            key: `${target.id}-${target.version}`,
            repo: 'templates',
        });
    }
    for (const entry of entries) {
        requireValue(
            /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(
                entry.image || '',
            ),
            'candidate_immutable_reference',
        );
        requireValue(
            /^[\w.-]+\/[\w.-]+$/.test(lock.repositories[entry.repo].repository),
            'candidate_repository',
        );
        const expectedRepository =
            'ghcr.io/' +
            lock.repositories[entry.repo].repository.toLowerCase() +
            (entry.repo === 'templates' ? '/' + entry.id : '');
        requireValue(
            entry.image.split('@')[0] === expectedRepository,
            'candidate_repository_mismatch',
        );
    }
    return entries;
}
/** Pure composition. CLI obtains actualSources and provenance independently; fixtures are not release proof. */
export function assertPlatformGate({
    lock,
    evidence,
    actualCommits,
    actualSources,
    lockBytes,
    verification,
    candidates,
    expectedRunId,
}) {
    validatePlatformLock(lock);
    for (const key of keys)
        requireValue(
            actualCommits?.[key] === lock.repositories[key].commit,
            `source_drift:${key}`,
        );
    requireValue(
        lockBytes &&
            JSON.stringify(JSON.parse(lockBytes)) === JSON.stringify(lock),
        'lock_bytes_missing_or_foreign',
    );
    const lockChecksum = checksum(lockBytes);
    requireValue(
        evidence?.schemaVersion === 1 && evidence.environment === 'isolated',
        'acceptance_schema_or_environment',
    );
    requireValue(
        evidence.lockChecksum === lockChecksum,
        'lock_checksum_mismatch',
    );
    const cases = completeAcceptance(evidence.cases);
    requireValue(
        cases.every(
            (c) =>
                c.status === 'passed' &&
                c.artifacts.length > 0 &&
                c.artifacts.every((a) => a.trim()),
        ),
        'acceptance_incomplete',
    );
    for (const target of acceptanceTemplates)
        requireValue(
            lock.templates.some(
                (t) => t.id === target.id && t.version === target.version,
            ),
            'required_template_missing',
        );
    requireValue(
        verification?.schemaVersion === 1 &&
            typeof expectedRunId === 'string' &&
            expectedRunId.length > 0 &&
            verification.runId === expectedRunId,
        'foreign_gate_run',
    );
    requireValue(
        Date.parse(verification.startedAt) >= Date.now() - 6 * 60 * 60 * 1000 &&
            Date.parse(verification.completedAt) <= Date.now() + 1000,
        'stale_or_future_gate',
    );
    currentWindow(verification, verification);
    currentWindow(evidence, verification);
    requireValue(
        verification.runtimeCleanupVerified === true,
        'runtime_cleanup_incomplete',
    );
    const { launch, owned, a4, b3 } = verification;
    requireValue(
        launch?.schemaVersion === 1 &&
            launch.evidenceType === 'lock-bound-launch-results' &&
            launch.passed === true &&
            launch.cleanupVerified === true &&
            launch.formalGate === null &&
            launch.lockChecksum === lockChecksum &&
            typeof launch.runId === 'string' &&
            launch.runId.length > 0,
        'launch_failed_or_foreign',
    );
    currentWindow(launch, verification);
    assert.deepEqual(
        completeAcceptance(launch.cases),
        cases,
        'launch_acceptance_mismatch',
    );
    requireValue(
        evidence.startedAt === launch.startedAt &&
            Date.parse(evidence.completedAt) <= Date.parse(launch.completedAt),
        'acceptance_launch_time_mismatch',
    );
    requireValue(
        owned?.scope === 'formal-owned-runtime' &&
            owned.runId === launch.runId &&
            owned.lockChecksum === lockChecksum &&
            owned.assertionsPassed === true &&
            owned.cleanupVerified === true,
        'owned_runtime_failed_or_foreign',
    );
    const cleanup = owned.cleanup;
    requireValue(
        cleanup?.sqlAbsent === true &&
            cleanup.mongoAbsent === true &&
            Array.isArray(cleanup.processGroups) &&
            cleanup.processGroups.length === 0 &&
            Array.isArray(cleanup.remainingContainers) &&
            cleanup.remainingContainers.length === 0 &&
            Object.keys(cleanup.portsClosed || {}).length > 0 &&
            Object.values(cleanup.portsClosed).every((v) => v === true),
        'owned_cleanup_incomplete',
    );
    for (const key of keys) {
        for (const sources of [actualSources, launch.source])
            requireValue(
                sources?.[key]?.commit === lock.repositories[key].commit &&
                    sources[key].workingTree === '' &&
                    sources[key].diffChecksum === emptyDiff,
                `dirty_or_foreign_source:${key}`,
            );
        requireValue(
            owned.source?.[key]?.head === lock.repositories[key].commit &&
                Array.isArray(owned.source[key].files) &&
                owned.source[key].files.length === 0,
            `owned_source_drift:${key}`,
        );
    }
    assert.deepEqual(
        a4?.build?.repositories,
        lock.repositories,
        'build_source_drift',
    );
    for (const entry of candidateEntries(lock, candidates)) {
        const image = a4.build.images?.[entry.key];
        requireValue(
            image?.provenanceVerified === true &&
                image.reference === entry.image &&
                image.sourceCommit === lock.repositories[entry.repo].commit &&
                digest.test(image.imageId),
            `candidate_artifact_mismatch:${entry.key}`,
        );
    }
    for (const target of lock.templates) {
        const records = owned.artifacts?.filter(
            (a) =>
                a.target?.id === target.id &&
                a.target?.version === target.version,
        );
        requireValue(
            records?.length === 1 &&
                records[0].image ===
                    candidates.templates.find(
                        (t) =>
                            t.id === target.id && t.version === target.version,
                    ).image &&
                records[0].previewArtifactDigest ===
                    target.previewArtifactDigest &&
                records[0].previewBundleDigest === target.previewBundleDigest,
            'owned_artifact_mismatch',
        );
    }
    currentWindow(a4.matrix, verification);
    currentWindow(a4.publication, verification);
    validateMatrixEvidence(
        a4.matrix,
        lock.repositories,
        lock.templates,
        a4.build.images,
    );
    validateLocalPublicationEvidence(
        a4.publication,
        lock.repositories,
        lock.templates,
        a4.build.images,
    );
    requireValue(
        b3?.schemaVersion === 1 &&
            b3.scope === 'B3-subset-only' &&
            b3.lockChecksum === lockChecksum &&
            b3.environment === 'isolated',
        'preview_scope_or_identity',
    );
    requireValue(b3.ownedRunId === launch.runId, 'foreign_preview_runtime');
    assert.deepEqual(b3.sourceCommits, actualCommits, 'preview_source_drift');
    requireValue(
        digest.test(b3.cmsAssets?.['index.html']) &&
            Object.entries(b3.cmsAssets).some(
                ([file, value]) => file.endsWith('.js') && digest.test(value),
            ),
        'preview_ui_build_unverified',
    );
    requireValue(
        Array.isArray(b3.sites) &&
            b3.sites.length === acceptanceTemplates.length,
        'preview_owned_sites',
    );
    for (const target of acceptanceTemplates) {
        const site = owned.sites?.find(
            (s) =>
                s.target?.id === target.id &&
                s.target.version === target.version,
        );
        const cells = b3.sites.filter(
            (s) =>
                s.templateId === target.id &&
                s.templateVersion === target.version,
        );
        requireValue(
            site &&
                cells.length === 1 &&
                cells[0].siteId === site.cmsSiteId &&
                cells[0].workspaceId === site.cmsWorkspaceId,
            'preview_foreign_site',
        );
    }
    currentWindow(b3, verification);
    requireValue(
        summarizePreview({
            lockBytes,
            cells: b3.cells,
            environment: b3.environment,
            startedAt: b3.startedAt,
        }).passed,
        'preview_incomplete',
    );
}
const execute = (command, args) =>
    execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
    });
/** Pull by digest, verify signed workflow/source provenance, and inspect real OCI identity. */
export function verifyCandidateArtifacts(lock, candidates, run = execute) {
    validatePlatformLock(lock);
    const images = {};
    for (const item of candidateEntries(lock, candidates)) {
        const source = lock.repositories[item.repo];
        const workflow =
            item.repo === 'templates' ? 'template-release.yml' : 'release.yml';
        const attestation = run('gh', [
            'attestation',
            'verify',
            `oci://${item.image}`,
            '--repo',
            source.repository,
            '--source-digest',
            source.commit,
            '--signer-workflow',
            `${source.repository}/.github/workflows/${workflow}`,
        ]);
        run('docker', ['pull', item.image]);
        const image = JSON.parse(
            run('docker', ['image', 'inspect', item.image]),
        )[0];
        requireValue(
            image?.RepoDigests?.includes(item.image) &&
                digest.test(image.Id) &&
                image.Config?.Labels?.['org.opencontainers.image.revision'] ===
                    source.commit &&
                image.Config?.Labels?.['org.opencontainers.image.version'] ===
                    item.version,
            'registry_artifact_identity_mismatch',
        );
        images[item.key] = {
            reference: item.image,
            imageId: image.Id,
            sourceCommit: source.commit,
            provenanceVerified: true,
            attestationChecksum: checksum(attestation),
        };
    }
    return { repositories: lock.repositories, images };
}
export function collectSources(roots) {
    return Object.fromEntries(
        keys.map((key) => {
            requireValue(roots[key], `missing_checkout:${key}`);
            const git = (args) =>
                execFileSync('git', args, {
                    cwd: roots[key],
                    encoding: 'utf8',
                });
            return [
                key,
                {
                    commit: git(['rev-parse', 'HEAD']).trim(),
                    workingTree: git([
                        'status',
                        '--porcelain',
                        '--untracked-files=all',
                    ]).trim(),
                    diffChecksum: checksum(git(['diff', 'HEAD', '--'])),
                },
            ];
        }),
    );
}
export async function hashEvidenceArtifacts(references, base, allowedRoot) {
    const root = await realpath(allowedRoot),
        hashes = {};
    for (const reference of new Set(references)) {
        const file = await realpath(path.resolve(base, reference));
        requireValue(file.startsWith(root + path.sep), 'artifact_outside_gate');
        requireValue((await stat(file)).isFile(), 'artifact_not_file');
        hashes[path.relative(root, file)] = checksum(await readFile(file));
    }
    return hashes;
}
export async function readPlatformReports(directory) {
    const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
    const verification = {};
    // Re-read producer files rather than trusting copies embedded in a caller's manifest.
    verification.launch = await readJSON(
        path.join(directory, 'launch-result.json'),
    );
    verification.owned = await readJSON(
        path.join(directory, 'owned/evidence.json'),
    );
    verification.b3 = verification.owned.platformPreview;
    const gateRoot = path.dirname(directory),
        a4Root = path.join(gateRoot, 'a4'),
        previewRoot = path.join(gateRoot, 'preview');
    verification.a4 = {
        matrix: await readJSON(path.join(a4Root, 'runtime-isolation.json')),
        publication: await readJSON(
            path.join(a4Root, 'local-publication.json'),
        ),
    };
    const previewEvidence = await readJSON(
        path.join(previewRoot, 'preview-AcceptanceEvidence.json'),
    );
    for (const [key, value] of Object.entries(previewEvidence))
        assert.deepEqual(
            verification.b3?.[key],
            value,
            'preview_report_mismatch',
        );
    const previewCells = (
        await Promise.all(
            acceptanceTemplates.map(
                async (t) =>
                    (
                        await readJSON(
                            path.join(previewRoot, t.id + '-cells.json'),
                        )
                    ).cells,
            ),
        )
    )
        .flat()
        .filter((c) => !c.id.endsWith('/LOCAL_SAVED_RUNTIME'));
    assert.deepEqual(
        verification.b3?.cells,
        previewCells,
        'preview_cells_mismatch',
    );
    return verification;
}
export async function verifyPlatformFiles(
    lockPath,
    evidencePath,
    env = process.env,
) {
    requireValue(
        env.E2E_GATE_RUN_ID && env.E2E_GATE_STARTED_AT && env.E2E_CANDIDATES,
        'current_gate_context_required',
    );
    const lockBytes = await readFile(lockPath),
        lock = validatePlatformLock(JSON.parse(lockBytes));
    const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const roots = {
        cms: root,
        gateway:
            env.E2E_GATEWAY_ROOT ||
            path.resolve(root, '../Independent-Website-Gateway'),
        templates:
            env.E2E_TEMPLATES_ROOT ||
            path.resolve(root, '../Independent-Website-Templates'),
        preview:
            env.E2E_PREVIEW_ROOT ||
            path.resolve(root, '../Independent-Website-Preview'),
    };
    const actualSources = collectSources(roots),
        actualCommits = Object.fromEntries(
            keys.map((k) => [k, actualSources[k].commit]),
        );
    for (const key of keys)
        requireValue(
            actualCommits[key] === lock.repositories[key].commit,
            `source_drift:${key}`,
        );
    const directory = path.dirname(evidencePath),
        candidates = await readJSON(env.E2E_CANDIDATES);
    const verification = await readJSON(
        path.join(directory, 'platform-verification.json'),
    );
    requireValue(
        verification.startedAt === env.E2E_GATE_STARTED_AT,
        'foreign_gate_start',
    );
    Object.assign(verification, await readPlatformReports(directory));
    verification.a4.build = verifyCandidateArtifacts(lock, candidates);
    const a4Root = path.join(path.dirname(directory), 'a4');
    const runtimeEnv = await readFile(path.join(a4Root, 'runtime.env'), 'utf8');
    const project = /^COMPOSE_PROJECT_NAME=(platform-a4-[a-f0-9]{10})$/m.exec(
        runtimeEnv,
    )?.[1];
    requireValue(project, 'runtime_cleanup_project_missing');
    for (const args of [
        ['ps', '-aq'],
        ['volume', 'ls', '-q'],
    ])
        requireValue(
            !execute('docker', [
                ...args,
                '--filter',
                'label=com.docker.compose.project=' + project,
            ]).trim(),
            'runtime_cleanup_incomplete',
        );
    verification.runtimeCleanupVerified = true;
    const evidence = await readJSON(evidencePath);
    assertPlatformGate({
        lock,
        lockBytes,
        evidence,
        actualCommits,
        actualSources,
        verification,
        candidates,
        expectedRunId: env.E2E_GATE_RUN_ID,
    });
    const artifactChecksums = await hashEvidenceArtifacts(
        [
            ...evidence.cases.flatMap((c) => c.artifacts),
            ...verification.b3.cells.flatMap((c) => c.artifacts),
            'launch-result.json',
            'owned/evidence.json',
            '../a4/runtime-isolation.json',
            '../a4/local-publication.json',
            '../preview/preview-AcceptanceEvidence.json',
            ...acceptanceTemplates.map(
                (t) => '../preview/' + t.id + '-cells.json',
            ),
        ],
        directory,
        path.dirname(directory),
    );
    const verificationBytes = JSON.stringify(verification, null, 2) + '\n';
    await writeFile(
        path.join(directory, 'platform-verification.json'),
        verificationBytes,
    );
    const receipt = {
        artifactChecksums,
        schemaVersion: 1,
        runId: verification.runId,
        lockChecksum: checksum(lockBytes),
        evidenceChecksum: checksum(await readFile(evidencePath)),
        verificationChecksum: checksum(verificationBytes),
        candidatesChecksum: checksum(await readFile(env.E2E_CANDIDATES)),
        repositories: lock.repositories,
        candidates,
        images: verification.a4.build.images,
    };
    await writeFile(
        path.join(directory, 'platform-gate-receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n',
    );
    return receipt;
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    try {
        requireValue(
            process.argv.length === 4,
            'Usage: node ops/release/verify-platform.mjs LOCK EVIDENCE',
        );
        await verifyPlatformFiles(process.argv[2], process.argv[3]);
        console.log('platform-gate: PASS');
    } catch (error) {
        // Child process stderr may contain registry credentials; report only a safe category.
        console.error(
            'platform-gate: FAIL: ' +
                (error.status !== undefined
                    ? 'registry_or_provenance_verification_failed'
                    : error.message),
        );
        process.exitCode = 1;
    }
}
