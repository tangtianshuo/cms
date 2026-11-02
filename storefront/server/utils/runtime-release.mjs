import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export class RuntimeReleaseError extends Error {
    constructor(code, message, options = {}) {
        super(message, options);
        this.name = 'RuntimeReleaseError';
        this.code = code;
    }
}

function fail(code, message, options) {
    throw new RuntimeReleaseError(code, message, options);
}

function isInside(root, target) {
    const result = relative(root, target);
    return result === '' || (result !== '..' && !result.startsWith('../') && !isAbsolute(result));
}

async function readJson(pathname, missingCode) {
    let raw;
    try {
        raw = await readFile(pathname, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') fail(missingCode, `Runtime artifact file is missing: ${pathname}`, { cause: error });
        throw error;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        fail('artifact_invalid', `Runtime artifact JSON is invalid: ${pathname}`, { cause: error });
    }
}

function sha256Json(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function requiredString(value, field) {
    if (typeof value !== 'string' || !value) fail('artifact_invalid', `Runtime artifact field ${field} is required`);
    return value;
}

export async function readRuntimeRelease({ artifactRoot, siteHost, releaseId, manifestPath = 'release.json' }) {
    if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot)) {
        fail('artifact_invalid', 'Runtime artifact root must be an absolute path');
    }
    const root = resolve(artifactRoot);
    const manifest = resolve(root, manifestPath);
    if (!isInside(root, manifest)) fail('artifact_invalid', 'Runtime manifest path escapes the artifact root');
    const value = await readJson(manifest, 'artifact_missing');
    const actualReleaseId = requiredString(value?.releaseId, 'releaseId');
    const actualSiteHost = requiredString(value?.siteHost, 'siteHost');
    requiredString(value?.templateId, 'templateId');
    requiredString(value?.templateVersion, 'templateVersion');
    requiredString(value?.rendererDigest, 'rendererDigest');
    if (actualSiteHost.toLowerCase() !== String(siteHost || '').toLowerCase()) {
        fail('site_mismatch', `Runtime artifact belongs to ${actualSiteHost}, not ${siteHost}`);
    }
    if (releaseId && actualReleaseId !== releaseId) {
        fail('release_mismatch', `Runtime artifact is ${actualReleaseId}, not ${releaseId}`);
    }
    if (!value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot)) {
        fail('artifact_invalid', 'Runtime artifact snapshot is required');
    }
    if (value.snapshotChecksum !== sha256Json(value.snapshot)) {
        fail('snapshot_checksum_mismatch', 'Runtime artifact snapshot checksum does not match');
    }
    const configuredAssetRoot = typeof value.assetRoot === 'string' && value.assetRoot ? value.assetRoot : 'assets';
    const assetRoot = resolve(root, configuredAssetRoot);
    if (!isInside(root, assetRoot)) fail('artifact_invalid', 'Runtime asset root escapes the artifact root');
    return { ...value, artifactRoot: root, manifestPath: manifest, assetRoot };
}

export async function readRuntimeAsset(release, requestPath) {
    if (!release || typeof release.assetRoot !== 'string' || typeof requestPath !== 'string' || !requestPath.startsWith('/_assets/')) {
        fail('asset_path_invalid', 'Published asset path is invalid');
    }
    const assetRoot = resolve(release.assetRoot);
    const relativePath = requestPath.slice('/_assets/'.length);
    const target = resolve(assetRoot, relativePath);
    if (!isInside(assetRoot, target) || !relativePath || relativePath.split('/').includes('..')) {
        fail('asset_path_invalid', 'Published asset path escapes the asset root');
    }
    try {
        return await readFile(target);
    } catch (error) {
        if (error?.code === 'ENOENT') fail('asset_missing', `Published asset is missing: ${requestPath}`, { cause: error });
        throw error;
    }
}
