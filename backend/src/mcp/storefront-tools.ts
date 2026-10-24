import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpApi } from './tools';
import { registerApiTools } from './tools';

const id = z.string().min(1).max(100);
const page = z.object({
    title: z.string().min(1).max(120),
    path: z.string().min(1).max(160),
    seoTitle: z.string().max(120),
    seoDescription: z.string().max(320),
    sections: z.array(z.string()).min(1),
    entryId: z.string(),
    enabled: z.boolean().optional(),
    navigation: z.boolean().optional(),
});

export function registerStorefrontTools(server: McpServer, api: McpApi) {
    registerApiTools(server, api, [
        {
            name: 'presets_list',
            description: 'List available storefront presets.',
            method: 'GET',
            path: () => '/api/v4/presets/catalog',
        },
        {
            name: 'preset_get',
            description: 'Get a storefront preset manifest.',
            method: 'GET',
            path: ({ presetId }) =>
                `/api/v4/presets/catalog/${encodeURIComponent(presetId)}`,
            inputSchema: { presetId: id },
        },
        {
            name: 'preset_install_plan',
            description:
                'Preview the model and page changes for installing a storefront preset.',
            method: 'GET',
            path: ({ presetId }) =>
                `/api/v4/presets/plan/${encodeURIComponent(presetId)}`,
            inputSchema: { presetId: id },
        },
        {
            name: 'storefront_site_get',
            description:
                'Get the selected site installation state, page drafts, checklist, and page options.',
            method: 'GET',
            path: () => '/api/v4/presets/site',
        },
        {
            name: 'storefront_preview_context_get',
            description:
                'Get the selected site preview context for a template.',
            method: 'GET',
            path: ({ templateId }) =>
                `/api/v4/presets/preview-context/${encodeURIComponent(
                    templateId,
                )}`,
            inputSchema: { templateId: id },
        },
        {
            name: 'storefront_preset_import',
            description:
                'Install or recover a storefront preset in the selected workspace and site.',
            method: 'POST',
            path: () => '/api/v4/presets/import',
            inputSchema: {
                presetId: id,
                siteName: z.string().trim().min(1).max(80),
                includeDemo: z.boolean(),
            },
            body: (input) => ({
                presetId: input.presetId,
                siteName: input.siteName,
                includeDemo: input.includeDemo,
            }),
            destructive: true,
        },
        {
            name: 'storefront_page_create',
            description: 'Create a page draft in the selected ready site.',
            method: 'POST',
            path: () => '/api/v4/presets/pages',
            inputSchema: { ...page.shape, blueprintKey: id },
            body: (input) => ({ ...input }),
            destructive: true,
        },
        {
            name: 'storefront_page_update',
            description:
                'Replace a page draft in the selected ready site. Use the current page key and complete page fields.',
            method: 'POST',
            path: ({ pageKey }) =>
                `/api/v4/presets/pages/${encodeURIComponent(pageKey)}`,
            inputSchema: { pageKey: id, ...page.shape },
            body: ({ pageKey: _pageKey, ...body }) => body,
            destructive: true,
        },
        {
            name: 'storefront_releases_history',
            description:
                'List published release history and audit events for the selected site.',
            method: 'GET',
            path: () => '/api/v4/presets/releases/',
        },
        {
            name: 'storefront_release_check',
            description:
                'Validate the selected site before publication. Check valid and issues in the returned body.',
            method: 'POST',
            path: () => '/api/v4/presets/releases/check',
            body: () => ({}),
        },
        {
            name: 'storefront_release_publish',
            description:
                'Publish the selected site. Pass expectedReleaseId from the latest check/history; use an empty string for the first release.',
            method: 'POST',
            path: () => '/api/v4/presets/releases/publish',
            inputSchema: { expectedReleaseId: z.string() },
            body: ({ expectedReleaseId }) => ({ expectedReleaseId }),
            destructive: true,
        },
        {
            name: 'storefront_release_rollback',
            description:
                'Switch the selected site to a previously published release. This changes public content immediately.',
            method: 'POST',
            path: () => '/api/v4/presets/releases/rollback',
            inputSchema: { expectedReleaseId: z.string(), releaseId: id },
            body: ({ expectedReleaseId, releaseId }) => ({
                expectedReleaseId,
                releaseId,
            }),
            destructive: true,
        },
    ]);
}
