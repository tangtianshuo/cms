import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpApi } from './tools';
import { registerApiTools } from './tools';

const id = z.string().min(1).max(100);
const shareResources = z
    .array(
        z
            .object({
                shareId: id,
                targetId: id.optional(),
                templateId: id.optional(),
                groupId: id.optional(),
                fieldMap: z.record(z.string()).optional(),
            })
            .strict(),
    )
    .min(1)
    .max(100);

export function registerDomainShareTools(server: McpServer, api: McpApi) {
    registerApiTools(server, api, [
        {
            name: 'site_domains_list',
            description:
                'List domain bindings and DNS/HTTPS setup guidance for the selected site.',
            method: 'GET',
            path: () => '/api/v4/site-domains',
        },
        {
            name: 'site_domain_add',
            description:
                'Begin domain ownership verification. Save the returned TXT name and value; the secret is not returned by list.',
            method: 'POST',
            path: () => '/api/v4/site-domains',
            inputSchema: { hostname: z.string().min(1).max(254) },
            body: ({ hostname }) => ({ hostname }),
        },
        {
            name: 'site_domain_check',
            description:
                'Check DNS ownership and HTTPS readiness for a domain. This performs network checks and changes verification state.',
            method: 'POST',
            path: ({ domainId }) =>
                `/api/v4/site-domains/${encodeURIComponent(domainId)}/check`,
            inputSchema: { domainId: id },
            destructive: true,
        },
        {
            name: 'site_domain_set_primary',
            description:
                'Route the selected site through a verified enabled domain.',
            method: 'POST',
            path: ({ domainId }) =>
                `/api/v4/site-domains/${encodeURIComponent(domainId)}/primary`,
            inputSchema: { domainId: id },
            destructive: true,
        },
        {
            name: 'site_domain_set_enabled',
            description:
                'Enable or disable a domain. A primary domain cannot be disabled.',
            method: 'POST',
            path: ({ domainId }) =>
                `/api/v4/site-domains/${encodeURIComponent(domainId)}/state`,
            inputSchema: { domainId: id, enabled: z.boolean() },
            body: ({ enabled }) => ({ enabled }),
            destructive: true,
        },
        {
            name: 'site_domain_remove',
            description:
                'Remove a domain binding. A primary domain cannot be removed until another is made primary.',
            method: 'DELETE',
            path: ({ domainId }) =>
                `/api/v4/site-domains/${encodeURIComponent(domainId)}`,
            inputSchema: { domainId: id },
            destructive: true,
        },
        {
            name: 'resource_shares_incoming',
            description: 'List shares received by the selected workspace.',
            method: 'GET',
            path: () => '/api/v4/resource-shares/incoming',
        },
        {
            name: 'resource_shares_outgoing',
            description: 'List shares granted by the selected workspace.',
            method: 'GET',
            path: () => '/api/v4/resource-shares/outgoing',
        },
        {
            name: 'resource_share_grant',
            description:
                'Grant another workspace preview/copy access to an owned Entry, Media file, Widget, or Group.',
            method: 'POST',
            path: () => '/api/v4/resource-shares',
            inputSchema: {
                resourceType: z.enum(['Entry', 'Media', 'Widget', 'Group']),
                resourceId: id,
                targetWorkspaceId: id,
            },
            body: (input) => ({ ...input }),
            destructive: true,
        },
        {
            name: 'resource_share_preview',
            description:
                'Preview an active share snapshot in the selected target workspace.',
            method: 'GET',
            path: ({ shareId }) =>
                `/api/v4/resource-shares/${encodeURIComponent(shareId)}`,
            inputSchema: { shareId: id },
        },
        {
            name: 'resource_share_media_read',
            description: 'Read the immutable snapshot of a shared media item.',
            method: 'GET',
            path: ({ shareId }) =>
                `/api/v4/resource-shares/${encodeURIComponent(shareId)}/media`,
            inputSchema: { shareId: id },
        },
        {
            name: 'resource_share_revoke',
            description:
                'Revoke an outgoing share. Active copies may prevent revocation.',
            method: 'DELETE',
            path: ({ shareId }) =>
                `/api/v4/resource-shares/${encodeURIComponent(shareId)}`,
            inputSchema: { shareId: id },
            destructive: true,
        },
        {
            name: 'resource_share_copy',
            description:
                'Copy an explicitly selected dependency graph from active shares into the selected workspace. Entry resources require target template, group, and field mapping.',
            method: 'POST',
            path: ({ shareId }) =>
                `/api/v4/resource-shares/${encodeURIComponent(shareId)}/copy`,
            inputSchema: { resources: shareResources },
            body: ({ resources }) => ({ resources }),
            destructive: true,
        },
    ]);
}
