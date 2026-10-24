import type { ControllerMethodPreRequestHandlerData } from '../_server';
import { HttpStatus } from '../_server';
import type { UserPolicy } from '../user/models/policy';
import { Repo } from '../repo';
import { resolveWorkspaceContext, verifiedWorkspace, type WorkspacePrincipal } from './context';
export async function verifyRequestWorkspace(data: ControllerMethodPreRequestHandlerData, principal: WorkspacePrincipal, policy?: Partial<UserPolicy>) {
    const read = (name: string) => { const value = data.request.headers[name]; if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 100)) throw new Error('Invalid workspace selector'); return value as string | undefined; };
    try {
        const context = await resolveWorkspaceContext(principal, { workspaceId: read('x-bcms-workspace'), siteId: read('x-bcms-site') }, {
            workspace: (id) => Repo.workspace.methods.fresh(id), site: (id) => Repo.siteInstallation.methods.findFresh(id),
        });
        if (!context.instanceAdmin) {
            context.templatePermissions = policy?.templates || [];
            context.mediaPermissions = policy?.media || (context.apiKeyId ? undefined : { get: false, post: false, put: false, delete: false });
        }
        if (context.role === 'viewer' && !['GET', 'HEAD'].includes(data.request.method)) throw new Error('Workspace is read only');
        return { [verifiedWorkspace]: context };
    } catch (error) { throw data.errorHandler(HttpStatus.Forbidden, (error as Error).message); }
}
