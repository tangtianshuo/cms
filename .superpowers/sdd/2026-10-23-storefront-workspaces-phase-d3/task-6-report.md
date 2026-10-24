# Task 6 report: workspace management UI

Date: 2026-10-24

Status: **DONE_WITH_CONCERNS** — implementation, independent static review, review fixes and compiler/build checks are complete; browser/runtime acceptance remains outstanding.

Branch: `codex/storefront-domains-workspaces`

Commit: `feat: add workspace site domain and sharing management UI` (exact SHA in the implementer handoff).

## Delivered

- Added workspace, domain, Entry group and resource sharing management routes and navigation, with English and Simplified Chinese strings. The sidebar shows the verified workspace and selected site names.
- Workspace management discovers only authorized workspaces, validates selections, supports workspace creation/rename, membership role changes/removal, site listing/creation, and selecting a site before opening the existing template catalog. Instance ADMIN/SUDO controls workspace creation; workspace management uses the server's verified admin flag.
- Template import is gated on an explicit selected site and workspace administrator context. An empty site can install a template. Import requests continue to use the selected site's existing backend API; no operational domain fields are added to draft writes.
- Domain management supports adding a hostname, ephemeral one-time TXT display/copy, DNS and HTTPS configuration instructions, separate ownership and connection states, checks, primary selection, enable/disable, unbind, and opening an established enabled domain. Operations refresh their list even on failure and show actionable 409/429 feedback. It requires an explicit selected site and verified administrator context. TXT material is held only in component memory and can be dismissed.
- Entry group management supports list/create/rename/delete, with server validation for nonempty/default groups. Entry lists filter by group; editors select/move groups and include the group in change tracking and create/update bodies. The create action opens the local unsaved editor so an empty persisted Entry does not collide with another title before the user can fill it. Normalized title conflicts surface localized guidance plus the server error.
- Sharing supports Entry, Media, Widget and structured Group grants, authorized target workspace suggestions plus a free workspace ID, incoming/outgoing and revoked states, audit information, revocation, and source provenance. Source admins grant from their current ownership scope. Entry/media/Widget screens link into sharing; the Group resource is also selectable in the share manager.
- Incoming copy uses ordinary controls for root/dependency selections, per-Entry destination Template/group/full field mapping, and optional existing Widget/Group mappings. The server remains responsible for complete graph, permissions and compatibility validation. The UI explains that copies are independent and shows copied root/batch IDs and persisted source workspace/resource/version. Resource categories load independently when a user's content grants restrict some categories.
- Incoming private media previews fetch authenticated blobs, create local object URLs, and revoke those URLs on reset/unmount or grant revocation. In-flight previews check the current grant/version before writing so a refreshed revoked grant cannot restore a stale preview or selection.

## Context and media mechanics

- The SDK validates the saved workspace/site with `/api/v4/workspaces/current`; site names come from that workspace's authorized site list. Invalid persisted selectors recover at `/d/workspaces?recover=1`. Recovery discovery explicitly uses the default context, which the backend permits for legacy/default access, and receives only the caller's authorized workspace list.
- Central SDK sends include `x-bcms-workspace`/`x-bcms-site` for verified selected contexts. Explicit selector overrides are used for server validation/discovery; headers do not establish authority. All mutation permissions remain server enforced, including Template/Media grants for workspace admins.
- Switching validates first, persists selection, retires the SDK request epoch, stops the old socket, clears resource stores, and performs a full-page navigation. Pending requests reject after the retired epoch and cannot write successful old responses into stores. The reload resets handler latches and editor state. Scoped socket URLs carry the same workspace/site IDs; stopped or superseded sockets cannot dispatch messages or reconnect.
- Visible dashboard media metadata checks capability freshness every minute and on tab resume. Existing SDK expiry checks suppress unnecessary requests. Page/product iframe preview payloads renew every five minutes and on resume, using the existing stale-response gate and cleanup hooks.
- Fixed the backend product preview response to map authorized media through `withMediaAccess`, matching the page-preview capability path. No admin JWT is placed in public media URLs.

## Verification evidence

Final commands were run against the implementation on 2026-10-24; all exited **0**:

| Command | Evidence |
| --- | --- |
| `PATH="$PWD/backend/node_modules/.bin:$PATH" NODE_PATH="$PWD/backend/node_modules" npm run build:types` | Root type generation completed; backend TypeScript compiled and declarations were refreshed. |
| `npm run build:noEmit --prefix backend` | Backend TypeScript completed without diagnostics. |
| `npm run type-check --prefix ui` | Vue/TypeScript completed without diagnostics. |
| `npm run build-only --prefix ui` | Vite production build completed, 544 modules transformed. |
| `npm run typecheck --prefix storefront` | Nuxt typecheck completed without diagnostics. |
| `npm run build --prefix storefront` | Nuxt client/server and Nitro production build completed. |
| `git diff --check` | No whitespace errors. |

The first plain root `npm run build:types` attempt failed because root `node_modules` did not contain `ts-node`. The command above reused the already installed backend tooling; no dependencies were installed or lockfiles changed. An initial UI typecheck exposed a JWT field mismatch (`roles` versus `rls`), which was corrected before the successful final checks.

UI build warnings remain for existing Sass slash division, outdated Browserslist data, Tailwind purge/content configuration, and the main bundle exceeding 500 kB. They did not fail the build.

Static review checked route/trailing-slash contracts, context recovery/switching, request and socket retirement, selected-site import gating, domain refresh/error handling, Entry group mutation bodies, sharing graph controls, preview cleanup and media capability renewal.

## Coverage limits and follow-up

- No tests were added or run under the current execution constraint. No browser, isolated backend, database, DNS, TLS or behavioral acceptance flows were executed for Task 6. Previous tasks' runtime evidence is not counted as this task's verification.
- Task 7 must exercise login/context recovery, switching with old requests and unsaved editors, two sites in one workspace, restricted member/content roles, site installation, domain lifecycle/errors, cross-Template title conflicts/group moves, complete sharing dependency mapping/copy/revoke, and capability expiry/resume in editor and iframe previews using isolated test data.
- Full-page selection intentionally discards unsaved editor state. Copying still requires explicit selection/mapping of all transitive grants and may return actionable validation errors until those dependencies are supplied. The delivery provides independent copies; it does not add source synchronization.
- The independent static review found and the current working tree fixes two Important Task 6 integration defects: callers had dropped an implicit default EntryGroup, and draft preview authorization used workspace-admin/JWT-payload exemptions instead of fresh Template grants. See `task-6-review.md`. No push, merge, deployment, production DNS changes, Docker service changes or worktree creation occurred.
