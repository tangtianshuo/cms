import type {
    LocationQueryRaw,
    RouteLocationNormalized,
    RouteLocationRaw,
    RouteRecordRaw,
} from 'vue-router';

/**
 * Legacy template/Entry bookmarks still identify an authorized target, but all
 * editing is performed by the unified ContentWorkspace.
 */
export function legacyContentRedirect(
    to: RouteLocationNormalized,
): RouteLocationRaw {
    const query: LocationQueryRaw = {
        ...to.query,
        section: 'content',
    };
    if (typeof to.params.templateId === 'string') {
        query.templateId = to.params.templateId;
    }
    if (typeof to.params.entryId === 'string') {
        query.entryId = to.params.entryId;
        query.intent = to.params.entryId === 'create' ? 'create' : 'edit';
    }
    return { path: '/d/studio', query };
}

export const legacyContentRouteRecords: RouteRecordRaw[] = [
    {
        path: '/d/template',
        name: 'TemplatesView',
        redirect: legacyContentRedirect,
    },
    {
        path: '/d/template/:templateId',
        name: 'TemplateView',
        redirect: legacyContentRedirect,
    },
    {
        path: '/d/template/:templateId/entry',
        name: 'EntriesView',
        redirect: legacyContentRedirect,
    },
    {
        path: '/d/template/:templateId/entry/:entryId',
        name: 'EntryView',
        redirect: legacyContentRedirect,
    },
];
