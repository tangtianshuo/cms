/** Section and SEO media require explicit provenance for the selected site. */
export function siteImageOptions<T extends { siteId?: string; mimetype: string }>(media: readonly T[], siteId: string | undefined): T[] {
    return siteId ? media.filter(item => item.siteId === siteId && item.mimetype.startsWith('image/')) : [];
}
