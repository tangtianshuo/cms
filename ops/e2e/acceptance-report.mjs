// This exact contract is consumed by F1. Supplemental checks never expand it.
export const acceptanceCaseNames = Object.freeze([
    'CREATE',
    'CONTENT',
    'MEDIA',
    'NAVIGATION',
    'PAGE',
    'SEO',
    'PREVIEW_DESKTOP',
    'PREVIEW_MOBILE',
    'SINGLE_EDITOR',
    'LEGACY_EDITOR_LINKS',
    'STRUCTURED_CONTENT',
    'LIVE_UNSAVED_PREVIEW',
    'PREVIEW_RACE',
    'PARTIAL_SAVE',
    'EDIT_CONFLICT',
    'TEMPLATE_LAYOUT',
    'PUBLISH',
    'UPDATE',
    'ROLLBACK',
    'FAILURE_PRESERVES_ACTIVE',
    'DOMAINS',
    'ISOLATION',
    'LEADS',
    'ANALYTICS',
]);
export const acceptanceTemplates = Object.freeze([
    { id: 'aeroframe', version: '1.0.4' },
    { id: 'fireguard', version: '1.0.1' },
]);
export const requiredAcceptanceIds = Object.freeze(
    acceptanceTemplates.flatMap(({ id }) =>
        acceptanceCaseNames.map((name) => `${id}/${name}`),
    ),
);
export function completeAcceptance(cases) {
    if (!Array.isArray(cases)) throw Error('Invalid acceptance cases');
    const seen = new Map();
    for (const result of cases) {
        if (!requiredAcceptanceIds.includes(result?.id))
            throw Error('Unknown acceptance case');
        if (seen.has(result.id)) throw Error('Duplicate acceptance case');
        if (
            !['passed', 'failed', 'blocked', 'not-run'].includes(
                result.status,
            ) ||
            typeof result.reason !== 'string' ||
            !Array.isArray(result.artifacts) ||
            result.artifacts.some((item) => typeof item !== 'string')
        )
            throw Error('Invalid acceptance case');
        seen.set(result.id, result);
    }
    return requiredAcceptanceIds.map(
        (id) =>
            seen.get(id) || {
                id,
                status: 'not-run',
                reason: 'Mandatory case result absent',
                artifacts: [],
            },
    );
}
export function summarizeAcceptance(cases) {
    const complete = completeAcceptance(cases);
    return {
        passed: complete.every((item) => item.status === 'passed'),
        failed: complete
            .filter((item) => item.status === 'failed')
            .map((item) => item.id),
        blocked: complete
            .filter((item) => item.status === 'blocked')
            .map((item) => item.id),
        notRun: complete
            .filter((item) => item.status === 'not-run')
            .map((item) => item.id),
    };
}
export function acceptanceEvidence({
    cases,
    lockChecksum,
    environment,
    startedAt = new Date().toISOString(),
    completedAt = new Date().toISOString(),
}) {
    if (
        typeof lockChecksum !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(lockChecksum)
    )
        throw Error('Valid lock checksum required for AcceptanceEvidence');
    if (!['isolated', 'staging', 'production'].includes(environment))
        throw Error('Invalid acceptance environment');
    const complete = completeAcceptance(cases);
    if (
        complete.some(
            (item) => item.status === 'passed' && !item.artifacts.length,
        )
    )
        throw Error('Passing acceptance case requires an artifact');
    return {
        schemaVersion: 1,
        lockChecksum,
        environment,
        startedAt,
        completedAt,
        cases: complete,
    };
}
