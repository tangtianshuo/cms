import type { Workspace } from '@bcms/selfhosted-backend/workspaces/repo';
import type { WorkspaceContext } from '@bcms/selfhosted-backend/workspaces/context';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
export interface ScopeSelection {
    workspaceId: string;
    siteId?: string;
}
export interface SelectedContext {
    workspace: Workspace;
    context: WorkspaceContext;
    site?: SiteInstallation;
}
export interface SiteList {
    items: SiteInstallation[];
    selectedSiteId: string;
}
