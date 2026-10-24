import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpApi } from './tools';
import { registerApiTools } from './tools';

const workspaceNameSchema = z.string().trim().min(1).max(80);
const userId = z.string().min(1).max(100);

export function registerWorkspaceTools(server: McpServer, api: McpApi) {
    registerApiTools(server, api, [
        {
            name: 'workspaces_list',
            description:
                'List workspaces accessible to the authenticated user.',
            method: 'GET',
            path: () => '/api/v4/workspaces',
        },
        {
            name: 'workspace_get_current',
            description:
                'Get the workspace and site context selected by this MCP request headers.',
            method: 'GET',
            path: () => '/api/v4/workspaces/current',
        },
        {
            name: 'workspace_create',
            description:
                'Create a workspace. Requires an instance administrator.',
            method: 'POST',
            path: () => '/api/v4/workspaces',
            inputSchema: { name: workspaceNameSchema },
            body: ({ name }) => ({ name }),
        },
        {
            name: 'workspace_rename',
            description:
                'Rename the selected workspace. Requires workspace administrator access.',
            method: 'PUT',
            path: () => '/api/v4/workspaces/current',
            inputSchema: { name: workspaceNameSchema },
            body: ({ name }) => ({ name }),
        },
        {
            name: 'workspace_delete',
            description:
                'Delete the selected non-default workspace. Fails when it still contains resources or sites.',
            method: 'DELETE',
            path: () => '/api/v4/workspaces/current',
            destructive: true,
        },
        {
            name: 'workspace_members_upsert',
            description:
                'Set a workspace member role to admin, editor, or viewer.',
            method: 'PUT',
            path: (input) =>
                `/api/v4/workspaces/current/members/${encodeURIComponent(
                    input.userId,
                )}`,
            inputSchema: {
                userId,
                role: z.enum(['admin', 'editor', 'viewer']),
            },
            body: ({ role }) => ({ role }),
            destructive: true,
        },
        {
            name: 'workspace_member_remove',
            description: 'Remove a member from the selected workspace.',
            method: 'DELETE',
            path: (input) =>
                `/api/v4/workspaces/current/members/${encodeURIComponent(
                    input.userId,
                )}`,
            inputSchema: { userId },
            destructive: true,
        },
        {
            name: 'workspace_sites_list',
            description: 'List sites in the selected workspace.',
            method: 'GET',
            path: () => '/api/v4/workspaces/current/sites',
        },
        {
            name: 'workspace_site_create',
            description: 'Create an empty site in the selected workspace.',
            method: 'POST',
            path: () => '/api/v4/workspaces/current/sites',
            inputSchema: { name: workspaceNameSchema },
            body: ({ name }) => ({ name }),
        },
    ]);
}
