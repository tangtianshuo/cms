import { extname } from 'node:path';
import { readRuntimeAsset, readRuntimeRelease, RuntimeReleaseError } from '../../utils/runtime-release.mjs';
import { siteContext } from '../../utils/site-context';

const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp',
};

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const artifactRoot = config.runtimeArtifactRoot;
    if (!artifactRoot) {
        throw createError({ statusCode: 404, statusMessage: 'Published asset not found' });
    }
    const relativePath = getRouterParam(event, 'path');
    const requestPath = `/_assets/${relativePath || ''}`;
    try {
        const release = await readRuntimeRelease({
            artifactRoot,
            siteHost: siteContext(event),
            releaseId: config.runtimeReleaseId,
        });
        const asset = await readRuntimeAsset(release, requestPath);
        setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
        setHeader(event, 'Content-Type', contentTypes[extname(requestPath).toLowerCase()] || 'application/octet-stream');
        return asset;
    } catch (error) {
        if (error instanceof RuntimeReleaseError && error.code === 'asset_missing') {
            throw createError({ statusCode: 404, statusMessage: 'Published asset not found' });
        }
        throw createError({ statusCode: 502, statusMessage: 'Published asset unavailable' });
    }
});
