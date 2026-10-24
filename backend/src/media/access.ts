import { createHmac, timingSafeEqual } from 'node:crypto';
import { Config } from '../config';
import { Repo } from '../repo';
import type { Media } from './models/main';
import { ownerWorkspace, runWithWorkspace, workspaceContext, type WorkspaceContext } from '../workspaces/context';
import { revalidateWorkspace } from '../workspaces/revalidate';
const lifetime = 15 * 60 * 1000;
const signature = (data: string) => createHmac('sha256', Config.jwtSecret).update(`bcms-media-v1:${data}`).digest('base64url');
export function withMediaAccess(media: Media): Media {
    const context = workspaceContext();
    if (!context || context.actorId.startsWith('__') || ownerWorkspace(media) !== context.workspaceId) return { ...media };
    const expiresAt = Date.now() + lifetime;
    const payload = Buffer.from(JSON.stringify({ id: media._id, workspaceId: context.workspaceId, actorId: context.actorId, apiKeyId: context.apiKeyId, exp: expiresAt })).toString('base64url');
    return { ...media, accessToken: `${payload}.${signature(payload)}`, accessTokenExpiresAt: expiresAt };
}
export function mediaAccessQuery(media: Media) { return media.accessToken ? `?cap=${encodeURIComponent(media.accessToken)}` : ''; }
export async function capabilityMedia(id: string, token: string): Promise<Media | null> {
    try {
        if (token.length > 2048) return null;
        const [payload, signed, extra] = token.split('.');
        if (!payload || !signed || extra) return null;
        const expected = Buffer.from(signature(payload)); const actual = Buffer.from(signed);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as WorkspaceContext & { id: string; exp: number };
        if (value.id !== id || !Number.isFinite(value.exp) || value.exp <= Date.now() || value.exp > Date.now() + lifetime) return null;
        const context = await revalidateWorkspace(value);
        return runWithWorkspace(context, () => Repo.media.findById(id));
    } catch { return null; }
}
export async function retainedPublicMedia(id: string): Promise<Media | null> {
    const reference = await Repo.storefrontRelease.methods.findRetainedMediaReference(id);
    return reference ? Repo.media.methods.findForAuthorizedBinary(id, reference.workspaceId) : null;
}
