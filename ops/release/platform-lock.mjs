import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
/** @typedef {{repository: string, commit: string}} SourceIdentity */
/** @typedef {{id: string, version: string, manifestChecksum: string, imageDigest: string, previewArtifactDigest: string, previewBundleDigest: string}} TemplateIdentity */
/** @typedef {{schemaVersion: 1, contractVersion: 1, repositories: Record<'cms'|'gateway'|'templates'|'preview', SourceIdentity>, templates: TemplateIdentity[]}} PlatformLock */
const object = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = /^sha256:[a-f0-9]{64}$/;
const version =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
/** Validate format only. Authenticity requires independent Git and artifact evidence.
 * @param {unknown} value
 * @returns {PlatformLock}
 */
export function validatePlatformLock(value) {
    const reject = (field) => {
        throw new Error(`Invalid PlatformLock: ${field}`);
    };
    if (
        !object(value) ||
        value.schemaVersion !== 1 ||
        value.contractVersion !== 1
    )
        reject('schema or contract version');
    if (!object(value.repositories)) reject('repositories');
    for (const key of ['cms', 'gateway', 'templates', 'preview']) {
        const identity = value.repositories[key];
        if (
            !object(identity) ||
            typeof identity.repository !== 'string' ||
            !identity.repository.trim() ||
            typeof identity.commit !== 'string' ||
            !/^[a-f0-9]{40}$/.test(identity.commit)
        )
            reject(`repositories.${key}`);
    }
    if (!Array.isArray(value.templates) || !value.templates.length)
        reject('templates');
    const seen = new Set();
    for (const item of value.templates) {
        if (
            !object(item) ||
            typeof item.id !== 'string' ||
            !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item.id) ||
            typeof item.version !== 'string' ||
            !version.test(item.version)
        )
            reject('template identity');
        const key = `${item.id}@${item.version}`;
        if (seen.has(key)) reject('duplicate template identity');
        seen.add(key);
        for (const key of [
            'manifestChecksum',
            'imageDigest',
            'previewArtifactDigest',
            'previewBundleDigest',
        ])
            if (typeof item[key] !== 'string' || !digest.test(item[key]))
                reject(`template.${key}`);
    }
    return /** @type {PlatformLock} */ (value);
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        if (process.argv[2] !== 'verify' || !process.argv[3])
            throw new Error(
                'Usage: node ops/release/platform-lock.mjs verify FILE',
            );
        validatePlatformLock(
            JSON.parse(await readFile(process.argv[3], 'utf8')),
        );
        console.log(
            'PlatformLock format valid; Git/registry authenticity must be verified separately.',
        );
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
