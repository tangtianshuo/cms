import { createHash } from 'node:crypto';

const digest = (value) =>
    'sha256:' + createHash('sha256').update(value).digest('hex');
const checksum = (value) =>
    typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

export function validatePublicationExpectation(expected) {
    if (
        !expected ||
        !Number.isSafeInteger(expected.activeRevision) ||
        expected.activeRevision <= 0 ||
        [
            'releaseId',
            'templateId',
            'templateVersion',
            'workspaceId',
            'siteId',
            'siteUrl',
            'marker',
        ].some((key) => typeof expected[key] !== 'string' || !expected[key]) ||
        expected.marker.length > 256
    )
        throw new Error(
            'Exact publication release, revision, selected site, template and bounded marker are required',
        );
    const url = new URL(expected.siteUrl);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw new Error('Invalid expected public site URL');
    return expected;
}

export function verifyPublicationObservation(value, expected) {
    validatePublicationExpectation(expected);
    if (
        value?.schemaVersion !== 1 ||
        value.status !== 'ready' ||
        value.releaseId !== expected.releaseId ||
        value.activeRevision !== expected.activeRevision ||
        value.cmsWorkspaceId !== expected.workspaceId ||
        value.cmsSiteId !== expected.siteId ||
        value.template?.id !== expected.templateId ||
        value.template?.version !== expected.templateVersion ||
        new URL(value.siteUrl).href !== new URL(expected.siteUrl).href ||
        !checksum(value.snapshotChecksum) ||
        value.publishedHome?.projection !== 'home-hero-title' ||
        !checksum(value.publishedHome.contentChecksum) ||
        value.publishedHome.containsMarker !== true ||
        value.publishedHome.markerChecksum !== digest(expected.marker)
    )
        throw new Error(
            'Authoritative publication observation did not match the expected immutable release',
        );
    for (const key of ['imageDigest', 'manifestChecksum', 'sourceCommit']) {
        if (expected[key] && value.template[key] !== expected[key])
            throw new Error(
                'Published template does not match the exact platform lock',
            );
    }
    return value;
}

// The formal comparison issues exactly one selected-context GET, without recovery or draft reads.
export async function readAndVerifyPublication(send, expected) {
    validatePublicationExpectation(expected);
    const value = await send({
        method: 'GET',
        url:
            '/api/v4/presets/releases/gateway/observation?' +
            new URLSearchParams({ marker: expected.marker }),
    });
    return verifyPublicationObservation(value, expected);
}

// Install before login/navigation. An attempted recovery read is both stopped and a failed acceptance.
export async function installPublicationReadGuard(context) {
    let attempted = false;
    await context.route('**/api/v4/presets/releases/**', async (route) => {
        const request = route.request(),
            pathname = new URL(request.url()).pathname;
        if (
            request.method() === 'GET' &&
            pathname === '/api/v4/presets/releases/gateway/observation'
        )
            return route.continue();
        attempted = true;
        await route.abort('blockedbyclient');
    });
    return () => {
        if (attempted)
            throw new Error(
                'Formal publication setup attempted a recovery or mutation endpoint',
            );
    };
}
