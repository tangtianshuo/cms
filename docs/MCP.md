# BCMS MCP Server

The backend exposes a stateless MCP Streamable HTTP endpoint at `/mcp`. Tools
call the same `/api/v4` controllers as the UI, preserving API-key grants, JWT
roles, workspace/site isolation, validation, and controller side effects. The
MCP server does not create a separate authorization path. This endpoint accepts
MCP JSON-RPC requests with `POST`; other HTTP methods return `405`.

## Connection and scope

Send one supported authorization header on every MCP request:

```text
Authorization: ApiKey <API_KEY_ID>.<API_KEY_SECRET>
```

or:

```text
Authorization: Bearer <JWT>
```

Workspace and site are request-scoped, not persistent MCP session state. To
operate on a non-default context, send these headers on every initialize,
`tools/list`, and `tools/call` request:

```text
x-bcms-workspace: <workspace-id>
x-bcms-site: <site-id>
```

The site header is optional for APIs that do not use a site. API keys remain
bound to their workspace; a selector cannot expand their access. Workspace
membership does not bypass content API-key grants or content policies. The
controllers remain authoritative: viewers cannot write, and instance-admin
operations still require the corresponding administrator credential.

## Tool coverage

| Area | Tools |
| --- | --- |
| Workspace | `workspaces_list`, `workspace_get_current`, `workspace_create`, `workspace_rename`, `workspace_delete`, `workspace_members_upsert`, `workspace_member_remove`, `workspace_sites_list`, `workspace_site_create` |
| Storefront setup | `presets_list`, `preset_get`, `preset_install_plan`, `storefront_site_get`, `storefront_preview_context_get`, `storefront_preset_import`, `storefront_page_create`, `storefront_page_update` |
| Storefront release | `storefront_releases_history`, `storefront_release_check`, `storefront_release_publish`, `storefront_release_rollback` |
| Domains | `site_domains_list`, `site_domain_add`, `site_domain_check`, `site_domain_set_primary`, `site_domain_set_enabled`, `site_domain_remove` |
| Resource shares | `resource_shares_incoming`, `resource_shares_outgoing`, `resource_share_grant`, `resource_share_preview`, `resource_share_media_read`, `resource_share_revoke`, `resource_share_copy` |
| Content models | `templates_list`, `template_get`, `template_where_used`, `template_create`, `template_update`, `template_delete`, `widgets_list`, `widgets_get`, `widget_where_used`, `widget_create`, `widget_update`, `widget_delete`, `groups_list`, `groups_get`, `group_where_used`, `group_create`, `group_update`, `group_delete`, `template_organizers_list`, `template_organizer_get`, `template_organizer_create`, `template_organizer_update`, `template_organizer_delete`, `languages_list`, `language_get`, `language_create`, `language_delete`, `entry_statuses_list`, `entry_status_get`, `entry_status_create`, `entry_status_update`, `entry_status_delete` |
| Entries and groups | `entries_list`, `entries_list_lite`, `entries_list_for_template_lite`, `entries_list_parsed`, `entry_get`, `entry_get_lite`, `entry_get_parsed`, `entry_create`, `entry_update`, `entry_publish`, `entry_delete`, `entry_groups_list`, `entry_group_create`, `entry_group_rename`, `entry_group_delete_empty`, `entry_group_move_entry` |
| Media | `media_list`, `media_get`, `media_file_read`, `media_upload_token_request`, `media_file_upload`, `media_directory_create`, `media_update`, `media_delete` |
| Administration | `user_stats_get`, `users_list`, `users_get`, `user_create`, `user_update`, `user_delete`, `user_avatar_upload`, `api_keys_list`, `api_keys_get`, `api_key_create`, `api_key_update`, `api_key_delete`, `plugins_list`, `functions_list_available`, `function_execute`, `types_generate` |
| Backups | `backups_list`, `backup_get`, `backup_download`, `backup_create`, `backup_delete`, `backup_restore_upload_token_request`, `backup_restore_upload` |

List/get tools return the API's structured JSON in MCP text content. Binary
downloads return `{ "contentType": "...", "base64": "..." }`. API errors
are returned as MCP tool errors with the backend error message.

## Important workflows

- **Create an entry:** call `templates_list`, `languages_list`, and
  `entry_statuses_list` first. `entry_create` takes property values in BCMS
  `{ "id": "<property-id>", "data": ... }` form and content as ProseMirror
  nodes. Entry updates replace the complete metadata and nodes for one
  language.
- **Create or change a model:** `template_create` accepts every BCMS property
  type, including enumeration, entry/group pointers, and widgets. Supply the
  type-specific `data` object when the generated empty default is insufficient;
  `template_update` forwards the normal `propChanges` structure to the API.
- **Install a storefront:** list workspaces and sites, select both with request
  headers, inspect the preset and install plan, then call
  `storefront_preset_import`. Import can return an `importing` site; confirm
  `storefront_site_get` reports `ready` before editing pages or publishing.
- **Publish/rollback:** run `storefront_release_check` and inspect `valid` and
  `issues`. Pass the current `expectedReleaseId` to publish or rollback. These
  operations change public content and use compare-and-set revisions; reload
  history after a conflict instead of blindly retrying.
- **Connect a domain:** add the hostname and save the returned TXT record,
  configure DNS/HTTPS, run `site_domain_check`, then set it primary. The TXT
  secret is only returned by the add call and expires after 24 hours. A primary
  domain must be replaced before it can be disabled or removed.
- **Share resources:** grant access from the source workspace, then switch the
  request headers to the target workspace to preview/copy. Copy requires an
  explicit dependency graph; Entry copies need target template, group, and
  field mappings. Grant, copy, revoke, workspace deletion, user/role/API-key
  changes, domain routing changes, and backup restore are consequential
  actions; each has its own tool and retains backend authorization checks.
- **Upload a media file:** request a fresh upload token, then call
  `media_file_upload` with that token, file name, MIME type, and base64 file
  bytes. Tokens are single-use, short-lived, and bound to the workspace. MCP
  JSON requests cap encoded file data at 900 kB (about 675 kB of bytes); use
  the direct media API for larger files, which the backend permits up to
  100 MiB.
- **Restore a backup:** request a restore token and call `backup_restore_upload`
  with the archive bytes. MCP JSON requests cap the encoded archive at 900 kB;
  use the direct backup API for larger archives. Restore can replace data; it
  requires the backend's instance-admin authorization and a fresh one-use
  token.
- **Execute a function:** list available functions and invoke one by name.
  Execution is only available to an API key explicitly granted that function;
  it may perform arbitrary configured actions.

## Backend operations not exposed

The tool list reflects real controller routes. The current backend has no
site-delete, page-delete, language-update, or plugin-execute controller
operation, so MCP does not advertise those actions.
Disable a non-home page with `enabled: false` instead of deleting it. Plugin
listing is read-only. Media binary reads use the regular media access checks;
shared media snapshots are available only through an active resource share.
