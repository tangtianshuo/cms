import type { WorkspaceContext, WorkspaceRole } from '../workspaces/context';

/** Capabilities are deliberately site scoped even though the first role model
 * is workspace scoped. This keeps route checks explicit while leaving room for
 * per-site grants without trusting selectors from the browser. */
export type SiteCapability =
    | 'content.read'
    | 'content.write'
    | 'pages.manage'
    | 'publish'
    | 'domains.manage'
    | 'operations.read'
    | 'operations.manage';

const roleCapabilities: Record<WorkspaceRole, readonly SiteCapability[]> = {
    viewer: ['content.read'],
    editor: ['content.read', 'content.write'],
    admin: [
        'content.read',
        'content.write',
        'pages.manage',
        'publish',
        'domains.manage',
        'operations.read',
        'operations.manage',
    ],
};

export function siteCapabilities(role: WorkspaceRole): readonly SiteCapability[] {
    return roleCapabilities[role];
}

export function hasSiteCapability(
    context: WorkspaceContext | undefined,
    capability: SiteCapability,
): boolean {
    if (!context) return false;
    if (context.instanceAdmin || context.admin) return true;
    return siteCapabilities(context.role).includes(capability);
}

export function assertSiteCapability(
    context: WorkspaceContext | undefined,
    capability: SiteCapability,
): asserts context is WorkspaceContext {
    if (!hasSiteCapability(context, capability)) {
        throw Object.assign(
            new Error(`Site capability required: ${capability}`),
            { status: 403 },
        );
    }
}
