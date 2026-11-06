/** Internal control-plane identity. Service credentials belong only in server config. */
export interface SiteGatewayBinding {
    cmsWorkspaceId: string;
    cmsSiteId: string;
    workspaceId: string;
    siteId: string;
    siteUrl: string;
    source: 'provisioned' | 'legacy';
}

export interface BindingReader {
    find(cmsWorkspaceId: string, cmsSiteId: string): Promise<SiteGatewayBinding | null>;
    listProvisioned(): Promise<SiteGatewayBinding[]>;
}
