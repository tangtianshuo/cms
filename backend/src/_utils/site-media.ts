/** Resource provenance only; callers apply field-specific MIME restrictions. */
export function mediaReferenceAllowedForSite(
    media: { workspaceId?: string; siteId?: string },
    site: { _id: string; workspaceId?: string },
    options: { requireSiteBinding?: boolean } = {},
): boolean {
    const workspaceId = site.workspaceId || 'default';
    if ((media.workspaceId || 'default') !== workspaceId) return false;
    if (media.siteId && media.siteId !== site._id) return false;
    if ((options.requireSiteBinding || workspaceId !== 'default') && media.siteId !== site._id) return false;
    return true;
}
