import { Repo } from '../repo';
import { resolveWorkspaceContext, type WorkspaceContext } from './context';

/** Reload identity, membership and grants for long-lived socket/media capabilities. */
export async function revalidateWorkspace(prior: Pick<WorkspaceContext, 'workspaceId' | 'siteId' | 'actorId' | 'apiKeyId'>): Promise<WorkspaceContext> {
    const source = { workspace: (id: string) => Repo.workspace.methods.fresh(id), site: (id: string) => Repo.siteInstallation.methods.findFresh(id) };
    if (prior.apiKeyId) {
        const key = await Repo.apiKey.methods.findForAuthentication(prior.apiKeyId);
        if (!key || key.blocked || key._id !== prior.actorId) throw new Error('API key access revoked');
        const context = await resolveWorkspaceContext({ apiKeyId: key._id, workspaceId: key.workspaceId }, prior, source);
        context.templatePermissions = key.access.templates; return context;
    }
    const user = await Repo.user.methods.findForAuthentication(prior.actorId);
    if (!user || !user.roles.some(role => ['USER', 'ADMIN', 'SUDO'].includes(role.name))) throw new Error('User access revoked');
    const context = await resolveWorkspaceContext({ userId: user._id, roles: user.roles.map(role => role.name) }, prior, source);
    if (!context.instanceAdmin) {
        context.templatePermissions = user.customPool.policy?.templates || [];
        context.mediaPermissions = user.customPool.policy?.media || { get: false, post: false, put: false, delete: false };
    }
    return context;
}
