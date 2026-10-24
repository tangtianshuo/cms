import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpApi } from './tools';
import { registerApiTools } from './tools';
import { createMultipartFile } from './multipart';

const id = z.string().min(1).max(100);
const jsonBodySchema = z.record(z.unknown());
const uploadSchema = {
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120).default('application/octet-stream'),
    fileBase64: z.string().min(4).max(900_000),
};
const upload = (input: any) =>
    createMultipartFile(input.fileName, input.mimeType, input.fileBase64);
const resource = (base: string, key: string) => [
    {
        name: `${key}_list`,
        description: `List ${key} resources visible to this credential.`,
        method: 'GET' as const,
        path: () => `${base}/all`,
    },
    {
        name: `${key}_get`,
        description: `Get one ${key} by ID.`,
        method: 'GET' as const,
        path: (input: any) => `${base}/${encodeURIComponent(input.id)}`,
        inputSchema: { id },
    },
];

export function registerCmsTools(server: McpServer, api: McpApi) {
    registerApiTools(server, api, [
        {
            name: 'template_get',
            description: 'Get a template schema by ID.',
            method: 'GET',
            path: ({ templateId }) =>
                `/api/v4/template/${encodeURIComponent(templateId)}`,
            inputSchema: { templateId: id },
        },
        {
            name: 'template_where_used',
            description:
                'Find groups, templates, and widgets that reference this template.',
            method: 'GET',
            path: ({ templateId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/where-is-it-used`,
            inputSchema: { templateId: id },
        },
        {
            name: 'template_update',
            description:
                'Update template metadata or apply BCMS propChanges. Existing content may be affected by property changes.',
            method: 'PUT',
            path: () => '/api/v4/template/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'template_delete',
            description:
                'Delete a template. Existing entries or references may prevent deletion.',
            method: 'DELETE',
            path: ({ templateId }) =>
                `/api/v4/template/${encodeURIComponent(templateId)}`,
            inputSchema: { templateId: id },
            destructive: true,
        },
        ...resource('/api/v4/widget', 'widgets'),
        {
            name: 'widget_where_used',
            description: 'Find entries that reference this widget.',
            method: 'GET',
            path: ({ widgetId }) =>
                `/api/v4/widget/${encodeURIComponent(
                    widgetId,
                )}/where-is-it-used`,
            inputSchema: { widgetId: id },
        },
        {
            name: 'widget_create',
            description: 'Create a Widget schema.',
            method: 'POST',
            path: () => '/api/v4/widget/create',
            inputSchema: {
                label: z.string().min(1),
                desc: z.string().default(''),
            },
            body: ({ label, desc }) => ({ label, desc }),
        },
        {
            name: 'widget_update',
            description: 'Update a Widget schema.',
            method: 'PUT',
            path: () => '/api/v4/widget/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'widget_delete',
            description: 'Delete a Widget schema.',
            method: 'DELETE',
            path: ({ widgetId }) =>
                `/api/v4/widget/${encodeURIComponent(widgetId)}`,
            inputSchema: { widgetId: id },
            destructive: true,
        },
        ...resource('/api/v4/group', 'groups'),
        {
            name: 'group_where_used',
            description:
                'Find groups, templates, and widgets that reference this group.',
            method: 'GET',
            path: ({ groupId }) =>
                `/api/v4/group/${encodeURIComponent(groupId)}/where-is-it-used`,
            inputSchema: { groupId: id },
        },
        {
            name: 'group_create',
            description: 'Create a content Group schema.',
            method: 'POST',
            path: () => '/api/v4/group/create',
            inputSchema: {
                label: z.string().min(1),
                desc: z.string().default(''),
            },
            body: ({ label, desc }) => ({ label, desc }),
        },
        {
            name: 'group_update',
            description: 'Update a content Group schema.',
            method: 'PUT',
            path: () => '/api/v4/group/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'group_delete',
            description: 'Delete a content Group schema.',
            method: 'DELETE',
            path: ({ groupId }) =>
                `/api/v4/group/${encodeURIComponent(groupId)}`,
            inputSchema: { groupId: id },
            destructive: true,
        },
        {
            name: 'template_organizers_list',
            description: 'List template organizer folders.',
            method: 'GET',
            path: () => '/api/v4/template-organizer/all',
        },
        {
            name: 'template_organizer_get',
            description:
                'Get a template organizer folder and its template IDs.',
            method: 'GET',
            path: ({ organizerId }) =>
                `/api/v4/template-organizer/${encodeURIComponent(organizerId)}`,
            inputSchema: { organizerId: id },
        },
        {
            name: 'template_organizer_create',
            description: 'Create a template organizer folder.',
            method: 'POST',
            path: () => '/api/v4/template-organizer/create',
            inputSchema: { label: z.string().min(1), templateIds: z.array(id) },
            body: (input) => ({ ...input }),
        },
        {
            name: 'template_organizer_update',
            description:
                'Update a template organizer label or its ordered template IDs.',
            method: 'PUT',
            path: () => '/api/v4/template-organizer/update',
            inputSchema: {
                _id: id,
                label: z.string().min(1).optional(),
                templateIds: z.array(id).optional(),
            },
            body: (input) => ({ ...input }),
            destructive: true,
        },
        {
            name: 'template_organizer_delete',
            description: 'Delete a template organizer folder.',
            method: 'DELETE',
            path: ({ organizerId }) =>
                `/api/v4/template-organizer/${encodeURIComponent(organizerId)}`,
            inputSchema: { organizerId: id },
            destructive: true,
        },
        {
            name: 'language_get',
            description: 'Get a configured content language.',
            method: 'GET',
            path: ({ languageId }) =>
                `/api/v4/language/${encodeURIComponent(languageId)}`,
            inputSchema: { languageId: id },
        },
        {
            name: 'language_create',
            description:
                'Create a content language. Existing codes return the existing language.',
            method: 'POST',
            path: () => '/api/v4/language/create',
            inputSchema: {
                code: z.string().min(1),
                name: z.string().min(1),
                nativeName: z.string().min(1),
            },
            body: (input) => ({ ...input }),
        },
        {
            name: 'language_delete',
            description: 'Delete a content language.',
            method: 'DELETE',
            path: ({ languageId }) =>
                `/api/v4/language/${encodeURIComponent(languageId)}`,
            inputSchema: { languageId: id },
            destructive: true,
        },
        {
            name: 'entry_status_get',
            description: 'Get an entry status by ID.',
            method: 'GET',
            path: ({ statusId }) =>
                `/api/v4/entry-status/${encodeURIComponent(statusId)}`,
            inputSchema: { statusId: id },
        },
        {
            name: 'entry_status_create',
            description: 'Create an entry status.',
            method: 'POST',
            path: () => '/api/v4/entry-status/create',
            inputSchema: { label: z.string().min(1) },
            body: ({ label }) => ({ label }),
        },
        {
            name: 'entry_status_update',
            description: 'Rename an entry status.',
            method: 'PUT',
            path: () => '/api/v4/entry-status/update',
            inputSchema: { id, label: z.string().min(1) },
            body: ({ id: _id, label }) => ({ _id, label }),
        },
        {
            name: 'entry_status_delete',
            description: 'Delete an entry status.',
            method: 'DELETE',
            path: ({ statusId }) =>
                `/api/v4/entry-status/${encodeURIComponent(statusId)}`,
            inputSchema: { statusId: id },
            destructive: true,
        },
        {
            name: 'entry_groups_list',
            description:
                'List entry groups and the default group ID in the selected workspace/site.',
            method: 'GET',
            path: () => '/api/v4/entry-groups',
        },
        {
            name: 'entry_group_create',
            description: 'Create an entry group.',
            method: 'POST',
            path: () => '/api/v4/entry-groups',
            inputSchema: { name: z.string().trim().min(1).max(80) },
            body: ({ name }) => ({ name }),
        },
        {
            name: 'entry_group_rename',
            description: 'Rename an entry group.',
            method: 'PUT',
            path: ({ groupId }) =>
                `/api/v4/entry-groups/${encodeURIComponent(groupId)}`,
            inputSchema: {
                groupId: id,
                name: z.string().trim().min(1).max(80),
            },
            body: ({ name }) => ({ name }),
        },
        {
            name: 'entry_group_delete_empty',
            description: 'Delete an empty non-default entry group.',
            method: 'DELETE',
            path: ({ groupId }) =>
                `/api/v4/entry-groups/${encodeURIComponent(groupId)}`,
            inputSchema: { groupId: id },
            destructive: true,
        },
        {
            name: 'entry_group_move_entry',
            description: 'Move an entry into an entry group.',
            method: 'PUT',
            path: ({ groupId, entryId }) =>
                `/api/v4/entry-groups/${encodeURIComponent(
                    groupId,
                )}/entries/${encodeURIComponent(entryId)}`,
            inputSchema: { groupId: id, entryId: id },
            destructive: true,
        },
        {
            name: 'entries_list_lite',
            description: 'List lightweight entries visible across templates.',
            method: 'GET',
            path: () => '/api/v4/template/entry/all/lite',
        },
        {
            name: 'entries_list_for_template_lite',
            description: 'List lightweight entries for a template.',
            method: 'GET',
            path: ({ templateId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/entry/all/lite`,
            inputSchema: { templateId: id },
        },
        {
            name: 'entries_list_parsed',
            description: 'List parsed entries for a template.',
            method: 'GET',
            path: ({ templateId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/entry/all/parsed`,
            inputSchema: { templateId: id },
        },
        {
            name: 'entry_get_parsed',
            description: 'Get one parsed entry for a template.',
            method: 'GET',
            path: ({ templateId, entryId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/entry/${encodeURIComponent(entryId)}/parse`,
            inputSchema: { templateId: id, entryId: id },
        },
        {
            name: 'entry_get_lite',
            description: 'Get one lightweight entry record.',
            method: 'GET',
            path: ({ templateId, entryId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/entry/${encodeURIComponent(entryId)}/lite`,
            inputSchema: { templateId: id, entryId: id },
        },
        {
            name: 'entry_delete',
            description:
                'Delete an entry. Requires JWT authorization under the existing API rules.',
            method: 'DELETE',
            path: ({ templateId, entryId }) =>
                `/api/v4/template/${encodeURIComponent(
                    templateId,
                )}/entry/${encodeURIComponent(entryId)}`,
            inputSchema: { templateId: id, entryId: id },
            destructive: true,
        },
        {
            name: 'media_list',
            description: 'List media visible to this credential.',
            method: 'GET',
            path: () => '/api/v4/media/all',
        },
        {
            name: 'media_get',
            description: 'Get media metadata and access details.',
            method: 'GET',
            path: ({ mediaId }) =>
                `/api/v4/media/${encodeURIComponent(mediaId)}`,
            inputSchema: { mediaId: id },
        },
        {
            name: 'media_file_read',
            description:
                'Read a media binary or transformed thumbnail as base64. Media access is checked by the backend.',
            method: 'GET',
            path: ({ mediaId, filename, data, capability }) => {
                const query = new URLSearchParams({
                    data: Buffer.from(JSON.stringify(data || {})).toString(
                        'hex',
                    ),
                });
                if (capability) query.set('cap', capability);
                return `/api/v4/media/${encodeURIComponent(
                    mediaId,
                )}/bin/${encodeURIComponent(filename)}?${query}`;
            },
            inputSchema: {
                mediaId: id,
                filename: z.string().min(1).max(255),
                capability: z.string().optional(),
                data: z
                    .object({
                        thumbnail: z.boolean().optional(),
                        view: z.boolean().optional(),
                        image: z
                            .object({
                                width: z.number().int().positive().optional(),
                                height: z.number().int().positive().optional(),
                                quality: z
                                    .number()
                                    .int()
                                    .min(1)
                                    .max(100)
                                    .optional(),
                                webp: z.boolean().optional(),
                            })
                            .optional(),
                    })
                    .strict()
                    .optional(),
            },
        },
        {
            name: 'media_upload_token_request',
            description:
                'Request a short-lived, single-use token before uploading a media file.',
            method: 'GET',
            path: () => '/api/v4/media/request/upload-token',
            readOnly: false,
            destructive: true,
        },
        {
            name: 'media_file_upload',
            description:
                'Upload a file using a fresh single-use token from media_upload_token_request. MCP JSON requests cap base64 input at 900 kB (about 675 kB of file data); the backend itself allows larger uploads through its direct API.',
            method: 'POST',
            path: ({ token, parentId }) =>
                `/api/v4/media/create/file?token=${encodeURIComponent(token)}${
                    parentId ? `&parentId=${encodeURIComponent(parentId)}` : ''
                }`,
            inputSchema: {
                token: id,
                parentId: id.optional(),
                ...uploadSchema,
            },
            request: (input) => {
                const file = upload(input);
                return {
                    body: file.body,
                    options: { headers: { 'content-type': file.contentType } },
                };
            },
            destructive: true,
        },
        {
            name: 'media_directory_create',
            description: 'Create a media directory.',
            method: 'POST',
            path: () => '/api/v4/media/create/dir',
            inputSchema: { name: z.string().min(1), parentId: id.optional() },
            body: ({ name, parentId }) => ({ name, parentId }),
        },
        {
            name: 'media_update',
            description: 'Update media name, parent, alt text, or caption.',
            method: 'PUT',
            path: () => '/api/v4/media/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'media_delete',
            description:
                'Delete media items by ID. Deleting a directory also recursively deletes its contents.',
            method: 'DELETE',
            path: () => '/api/v4/media/delete',
            inputSchema: { mediaIds: z.array(id).min(1) },
            body: ({ mediaIds }) => ({ mediaIds }),
            destructive: true,
        },
        {
            name: 'user_stats_get',
            description:
                'Get counts for entries, media, users, and media storage.',
            method: 'GET',
            path: () => '/api/v4/user/stats',
        },
        ...resource('/api/v4/user', 'users'),
        {
            name: 'user_create',
            description: 'Create a user. Requires an instance administrator.',
            method: 'POST',
            path: () => '/api/v4/user/create',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'user_update',
            description:
                'Update a user. Requires an instance administrator; role changes affect access immediately.',
            method: 'PUT',
            path: () => '/api/v4/user/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'user_delete',
            description: 'Delete a user. Requires an instance administrator.',
            method: 'DELETE',
            path: ({ userId }) => `/api/v4/user/${encodeURIComponent(userId)}`,
            inputSchema: { userId: id },
            destructive: true,
        },
        {
            name: 'user_avatar_upload',
            description:
                'Upload an image avatar for a user. Requires an instance administrator; MCP JSON requests cap the encoded file at 900 kB.',
            method: 'POST',
            path: ({ userId }) =>
                `/api/v4/user/${encodeURIComponent(userId)}/avatar`,
            inputSchema: { userId: id, ...uploadSchema },
            request: (input) => {
                const file = upload(input);
                return {
                    body: file.body,
                    options: { headers: { 'content-type': file.contentType } },
                };
            },
            destructive: true,
        },
        ...resource('/api/v4/api-key', 'api_keys'),
        {
            name: 'api_key_create',
            description:
                'Create an API key. Treat returned credentials as secrets.',
            method: 'POST',
            path: () => '/api/v4/api-key/create',
            inputSchema: {
                name: z.string().min(1),
                desc: z.string().default(''),
            },
            body: ({ name, desc }) => ({ name, desc }),
            destructive: true,
        },
        {
            name: 'api_key_update',
            description:
                'Change API key metadata, blocked status, or access grants.',
            method: 'PUT',
            path: () => '/api/v4/api-key/update',
            inputSchema: { body: jsonBodySchema },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'api_key_delete',
            description: 'Revoke an API key immediately.',
            method: 'DELETE',
            path: ({ apiKeyId }) =>
                `/api/v4/api-key/${encodeURIComponent(apiKeyId)}`,
            inputSchema: { apiKeyId: id },
            destructive: true,
        },
        {
            name: 'plugins_list',
            description:
                'List installed plugins. The backend currently exposes no plugin execution endpoint.',
            method: 'GET',
            path: () => '/api/v4/plugin/all',
        },
        {
            name: 'functions_list_available',
            description:
                'List callable functions permitted to this credential. API keys only see functions explicitly granted to them.',
            method: 'GET',
            path: () => '/api/v4/function/available',
        },
        {
            name: 'function_execute',
            description:
                'Execute a configured function. Requires an API key with an explicit grant for this function; function execution may perform arbitrary configured actions.',
            method: 'POST',
            path: ({ functionName }) =>
                `/api/v4/function/${encodeURIComponent(functionName)}`,
            inputSchema: { functionName: id, body: jsonBodySchema.optional() },
            body: ({ body }) => body,
            destructive: true,
        },
        {
            name: 'types_generate',
            description:
                'Generate the current content model files in a supported language.',
            method: 'GET',
            path: ({ language }) =>
                `/api/v4/type-generator/${encodeURIComponent(language)}`,
            inputSchema: { language: z.enum(['ts', 'rust', 'golang', 'gql']) },
        },
        {
            name: 'backups_list',
            description: 'List backups. Requires an instance administrator.',
            method: 'GET',
            path: () => '/api/v4/backup/all',
        },
        {
            name: 'backup_get',
            description: 'Get backup status and metadata.',
            method: 'GET',
            path: ({ backupId }) =>
                `/api/v4/backup/${encodeURIComponent(backupId)}`,
            inputSchema: { backupId: id },
        },
        {
            name: 'backup_download',
            description:
                'Download a ready backup. The result contains base64 archive bytes and content type.',
            method: 'GET',
            path: ({ backupId }) =>
                `/api/v4/backup/download/${encodeURIComponent(backupId)}`,
            inputSchema: { backupId: id },
        },
        {
            name: 'backup_create',
            description:
                'Queue a new backup. Check backup status before assuming it is ready.',
            method: 'POST',
            path: () => '/api/v4/backup/create',
            body: () => ({}),
            destructive: true,
        },
        {
            name: 'backup_delete',
            description: 'Delete a backup.',
            method: 'DELETE',
            path: ({ backupId }) =>
                `/api/v4/backup/${encodeURIComponent(backupId)}`,
            inputSchema: { backupId: id },
            destructive: true,
        },
        {
            name: 'backup_restore_upload_token_request',
            description:
                'Request a short-lived one-use token before uploading a backup archive for restore.',
            method: 'GET',
            path: () => '/api/v4/backup/request/restore-upload-token',
            readOnly: false,
            destructive: true,
        },
        {
            name: 'backup_restore_upload',
            description:
                'Restore from a backup archive using a fresh single-use token. This can replace workspace data; MCP JSON requests cap the encoded archive at 900 kB.',
            method: 'POST',
            path: ({ token }) =>
                `/api/v4/backup/restore?token=${encodeURIComponent(token)}`,
            inputSchema: { token: id, ...uploadSchema },
            request: (input) => {
                const file = upload(input);
                return {
                    body: file.body,
                    options: { headers: { 'content-type': file.contentType } },
                };
            },
            destructive: true,
        },
    ]);
}
