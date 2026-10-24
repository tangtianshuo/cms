import { AsyncLocalStorage } from 'node:async_hooks';
export const DEFAULT_WORKSPACE = 'default';
export type WorkspaceRole = 'admin' | 'editor' | 'viewer';
export interface WorkspaceContext {
    workspaceId: string;
    siteId?: string;
    actorId: string;
    admin: boolean;
    instanceAdmin: boolean;
    role: WorkspaceRole;
    apiKeyId?: string;
    templatePermissions?: Array<{ _id: string; get: boolean; post: boolean; put: boolean; delete: boolean }>;
    mediaPermissions?: { get: boolean; post: boolean; put: boolean; delete: boolean };
}
export type WorkspacePrincipal =
    | { userId: string; roles: string[] }
    | { apiKeyId: string; workspaceId?: string };
export interface ContextSource {
    workspace(
        id: string,
    ): Promise<{
        _id: string;
        members: Array<{ userId: string; role: WorkspaceRole }>;
    } | null>;
    site(id: string): Promise<{ _id: string; workspaceId?: string } | null>;
}
const storage = new AsyncLocalStorage<Readonly<WorkspaceContext> | undefined>();
export const verifiedWorkspace = Symbol('verifiedWorkspace');
export function workspaceContext() {
    return storage.getStore();
}
export function runWithWorkspace<T>(
    context: WorkspaceContext | undefined,
    action: () => T,
): T {
    return storage.run(context && Object.freeze({ ...context }), action);
}
export function workspaceId() {
    return workspaceContext()?.workspaceId || DEFAULT_WORKSPACE;
}
export function ownerWorkspace(value: { workspaceId?: string }) {
    return value.workspaceId || DEFAULT_WORKSPACE;
}
export function workspaceFilter(id = workspaceId()) {
    return id === DEFAULT_WORKSPACE
        ? { $or: [{ workspaceId: id }, { workspaceId: { $exists: false } }] }
        : { workspaceId: id };
}
export async function resolveWorkspaceContext(
    principal: WorkspacePrincipal,
    selector: { workspaceId?: string; siteId?: string },
    source: ContextSource,
): Promise<WorkspaceContext> {
    const id = selector.workspaceId || DEFAULT_WORKSPACE;
    let context: WorkspaceContext;
    if ('apiKeyId' in principal) {
        if (id !== (principal.workspaceId || DEFAULT_WORKSPACE))
            throw new Error('API key workspace access denied');
        if (id !== DEFAULT_WORKSPACE && !(await source.workspace(id)))
            throw new Error('Workspace access denied');
        context = {
            workspaceId: id,
            actorId: principal.apiKeyId,
            apiKeyId: principal.apiKeyId,
            admin: false,
            instanceAdmin: false,
            role: 'editor',
        };
    } else {
        const elevated = principal.roles.some(
            (role) => role === 'ADMIN' || role === 'SUDO',
        );
        const workspace = await source.workspace(id);
        const member = workspace?.members.find(
            (item) => item.userId === principal.userId,
        );
        if (
            (!workspace && id !== DEFAULT_WORKSPACE) ||
            (!elevated && !member && id !== DEFAULT_WORKSPACE)
        )
            throw new Error('Workspace access denied');
        const role = elevated ? 'admin' : member?.role || 'editor';
        context = {
            workspaceId: id,
            actorId: principal.userId,
            role,
            admin: elevated || role === 'admin',
            instanceAdmin: elevated,
        };
    }
    if (selector.siteId) {
        const site = await source.site(selector.siteId);
        if (!site || ownerWorkspace(site) !== id)
            throw new Error('Site not found in workspace');
        context.siteId = site._id;
    }
    return context;
}

export function workspaceCacheKey() {
    const context = workspaceContext();
    return JSON.stringify([workspaceId(), context?.actorId, context?.apiKeyId, context?.admin, context?.instanceAdmin, context?.role,
        context?.templatePermissions, context?.mediaPermissions]);
}
export function contentFilter(kind?: string, operation: 'get' | 'post' | 'put' | 'delete' = 'get') {
    const context = workspaceContext();
    const scope = workspaceFilter();
    if (!context || context.instanceAdmin || !['Entry', 'Template', 'Media'].includes(kind || '')) return scope;
    if (kind === 'Media') return !(context.mediaPermissions?.[operation] ?? Boolean(context.apiKeyId))
        ? { $and: [scope, { _id: { $in: [] as string[] } }] } : scope;
    const ids = (context.templatePermissions || []).filter(grant => grant[operation]).map(grant => grant._id);
    return { $and: [scope, { [kind === 'Entry' ? 'templateId' : '_id']: { $in: ids } }] };
}
export function canReadContent(kind: string, document: { _id?: string; templateId?: string }) {
    const context = workspaceContext();
    if (!context || context.instanceAdmin) return true;
    if (kind === 'Media') return context.mediaPermissions?.get ?? Boolean(context.apiKeyId);
    if (kind === 'Entry' || kind === 'Template') return Boolean(context.templatePermissions?.some(grant =>
        grant._id === (kind === 'Entry' ? document.templateId : document._id) && grant.get));
    return true;
}
export function canWriteContent(kind: string, document: { _id?: string; templateId?: string }, operation: 'post' | 'put' | 'delete') {
    const context = workspaceContext();
    if (!context || context.instanceAdmin) return true;
    if (context.role === 'viewer') return false;
    if (kind === 'Media') return context.mediaPermissions?.[operation] ?? Boolean(context.apiKeyId);
    if (kind === 'Entry' || kind === 'Template') return Boolean(context.templatePermissions?.some(grant =>
        grant._id === (kind === 'Entry' ? document.templateId : document._id) && grant[operation]));
    return true;
}
