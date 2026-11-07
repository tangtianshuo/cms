import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
    completeAcceptance,
    summarizeAcceptance,
    acceptanceEvidence,
} from './acceptance-report.mjs';
export async function createLaunchDirectory(directory) {
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    try {
        await mkdir(directory, { mode: 0o700 });
    } catch (error) {
        if (error.code === 'EEXIST')
            throw Error('Launch requires a fresh run directory');
        throw error;
    }
}
export function validateLaunchEnvelope(value, expected) {
    if (
        !value ||
        value.runId !== expected.runId ||
        value.lockChecksum !== expected.lockChecksum ||
        value.scope !== expected.scope ||
        value.target?.id !== expected.target.id ||
        value.target?.version !== expected.target.version
    )
        throw Error(
            'Launch result does not belong to the current run/lock/target/scope',
        );
    if (
        !Array.isArray(value.cases) ||
        value.cases.some((c) => !c.id?.startsWith(expected.target.id + '/'))
    )
        throw Error('Launch result contains another target');
    completeAcceptance(value.cases);
    return value.cases;
}
export function finalizeLaunchResults({
    cases,
    lockChecksum,
    browserExit,
    cleanupVerified,
    startedAt,
    completedAt,
}) {
    const executionPassed = browserExit === 0 && cleanupVerified === true;
    const completed = completeAcceptance(cases).map((c) =>
        !executionPassed && c.status === 'passed'
            ? {
                  ...c,
                  status: 'failed',
                  reason: 'Run execution or owned cleanup failed after case write; evidence withheld',
              }
            : c,
    );
    const summary = summarizeAcceptance(completed);
    return {
        ...summary,
        passed: summary.passed && executionPassed,
        cases: completed,
        consumerEvidence:
            executionPassed && lockChecksum
                ? acceptanceEvidence({
                      cases: completed,
                      lockChecksum,
                      environment: 'isolated',
                      startedAt,
                      completedAt,
                  })
                : null,
    };
}
