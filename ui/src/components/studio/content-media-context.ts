import type { ComputedRef, InjectionKey } from 'vue';
export type ContentMediaSite = { _id: string; workspaceId: string };
/** Only bound content supplies this. Historical content keeps workspace choices. */
export const contentMediaSiteKey: InjectionKey<ComputedRef<ContentMediaSite | undefined>> = Symbol('content-media-site');
