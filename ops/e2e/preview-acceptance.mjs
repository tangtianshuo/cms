import { createHash } from 'node:crypto';
import { validatePlatformLock } from '../release/platform-lock.mjs';
// D1 owns the full acceptance set. This is its composable B3 subset only.
export const previewCaseNames = Object.freeze([
    'LIVE_UNSAVED_PREVIEW',
    'NAVIGATION',
    'MEDIA',
    'STRUCTURED_CONTENT',
    'TEMPLATE_LAYOUT',
    'PUBLISH',
]);
export function requiredPreviewCells(lock) {
    validatePlatformLock(lock);
    const identities = [
        ['aeroframe', '1.0.4'],
        ['fireguard', '1.0.1'],
    ];
    for (const [id, version] of identities)
        if (
            !lock.templates.some(
                (item) => item.id === id && item.version === version,
            )
        )
            throw new Error('Required preview template identity missing');
    return identities.flatMap(([templateId, version]) =>
        ['desktop', 'mobile'].flatMap((viewport) =>
            [
                viewport === 'desktop' ? 'PREVIEW_DESKTOP' : 'PREVIEW_MOBILE',
                ...previewCaseNames,
            ].map((name) => ({
                id: `${templateId}/${name}`,
                templateId,
                version,
                viewport,
                dimensions:
                    viewport === 'desktop'
                        ? { width: 1440, height: 900 }
                        : { width: 390, height: 844 },
            })),
        ),
    );
}
export function summarizePreview({
    lockBytes,
    cells,
    environment,
    startedAt = new Date().toISOString(),
}) {
    const lock = validatePlatformLock(JSON.parse(lockBytes.toString('utf8')));
    if (!['isolated', 'staging', 'production'].includes(environment))
        throw new Error('Invalid acceptance environment');
    const lockChecksum =
        'sha256:' + createHash('sha256').update(lockBytes).digest('hex');
    const required = requiredPreviewCells(lock),
        seen = new Map();
    for (const cell of cells) {
        const identity = required.find(
            (item) =>
                item.id === cell.id &&
                item.templateId === cell.templateId &&
                item.version === cell.version &&
                item.viewport === cell.viewport,
        );
        if (!identity) throw new Error('Unknown preview case identity');
        if (
            cell.dimensions?.width !== identity.dimensions.width ||
            cell.dimensions?.height !== identity.dimensions.height
        )
            throw new Error('Preview viewport dimensions mismatch');
        const key = `${cell.id}/${cell.viewport}`;
        if (seen.has(key)) throw new Error('duplicate preview case');
        if (cell.lockChecksum !== lockChecksum)
            throw new Error('Preview case checksum mismatch');
        if (
            !['passed', 'failed', 'blocked', 'not-run'].includes(cell.status) ||
            typeof cell.reason !== 'string' ||
            !Array.isArray(cell.artifacts) ||
            cell.artifacts.some((item) => typeof item !== 'string')
        )
            throw new Error('Invalid preview case result');
        if (cell.status === 'passed' && !cell.artifacts.length)
            throw new Error('Passing preview case requires artifacts');
        seen.set(key, cell);
    }
    const completed = required.map(
        (identity) =>
            seen.get(`${identity.id}/${identity.viewport}`) || {
                ...identity,
                status: 'not-run',
                reason: 'Mandatory template/viewport result absent',
                artifacts: [],
                lockChecksum,
            },
    );
    const cases = [...new Set(required.map((item) => item.id))].map((id) => {
        const group = completed.filter((item) => item.id === id);
        const status =
            ['failed', 'blocked', 'not-run'].find((status) =>
                group.some((item) => item.status === status),
            ) || 'passed';
        return {
            id,
            status,
            reason: group
                .map(
                    (item) => `${item.viewport}: ${item.reason || item.status}`,
                )
                .join('; '),
            artifacts: [...new Set(group.flatMap((item) => item.artifacts))],
        };
    });
    return {
        passed: cases.every((item) => item.status === 'passed'),
        cells: completed,
        evidence: {
            schemaVersion: 1,
            lockChecksum,
            environment,
            startedAt,
            completedAt: new Date().toISOString(),
            cases,
        },
    };
}
