# Task 3 report — workspaces, verified context and independent installations

Status: DONE for Task 3 scope. Content-wide repository isolation, EntryGroups, media capabilities, sockets/MCP and resource sharing remain the explicitly assigned downstream tasks. This commit is not a claim that the full D3 security boundary is deployable before Task 4.

## Implemented

- Workspace persistence, list/create/read/rename/delete-empty and atomic membership updates. Default workspace is seeded idempotently. ADMIN/SUDO override; workspace `admin` members with only USER JWT can administer their own installation, pages, publication and domains. Editors/viewers cannot gain administration by selecting headers. Viewers cannot invoke mutation HTTP methods. Removing a member takes effect on the next request because membership authorization uses fresh Mongo reads.
- JWT/API-key route protection resolves a request-local verified context. Selectors cannot grant membership or select a site in another workspace. Missing headers always select `default`; an API key tagged to another workspace requires that workspace header and rejects a different/missing workspace. Untagged legacy keys remain default-only.
- Stable new-site identity, namespace and content-group metadata. Blank sites can be created and then installed via the existing preset endpoints. Namespaces are `site-${siteId}-${modelKey}` for all five imported models, so two sites in one workspace have independent singleton models, demo entries, props, pages and themes. Imports preserve repeat demo names and stable site-based demo IDs. Existing default model names/IDs/prop mappings remain unchanged.
- Existing-site installation claim uses the site revision CAS to prevent competing imports from duplicating models or overwriting another preset. Failed import resume retains the same namespace and mappings.
- Selected-site adapters for preset page drafts, preview context, product/page preview, releases and domains. Publication snapshots/envelopes carry workspace ownership. Public routing verifies binding → site → release envelope → snapshot ownership; old untagged records are default-only. Publication and rollback remain independent per site.
- `saveDraft`/`updateImport` exclude all publication/domain operational fields, including **domainAuditOutbox**. They also exclude ownership, slot, namespace and group identity. Scoped write filters prevent cross-workspace draft writes. `updateImport` returns the fresh persisted document, including current operational pointers. The D1 atomic primary/revision/outbox write and fenced lease are unchanged.
- Explicit safe legacy index migration runs through the repository `beforeIndexes` hook: backfill missing Template/SiteInstallation workspaceId to `default`, successfully build the compound unique index, then drop only the known old index. Failure to establish uniqueness fails startup. Repeated migration and another process already dropping the old index are safe. Legacy ID/prop data are not rewritten; Release documents/payloads are untouched.

## Exact HTTP contract for Task 6

All paths below have **no trailing slash**. All use JWT authentication. Existing preset/release/domain route paths retain their prior slash behavior (release history remains `/api/v4/presets/releases/`).

- `GET /api/v4/workspaces` → `{items: Workspace[], selectedWorkspaceId, selectedSiteId}`. Non-instance admins see the default workspace plus explicit memberships.
- `POST /api/v4/workspaces` `{name}` → Workspace directly. Instance ADMIN/SUDO only; creator becomes workspace admin.
- `GET /api/v4/workspaces/current` → `{workspace, context}`.
- `PUT /api/v4/workspaces/current` `{name}` → `{ok:true}`; workspace admin.
- `DELETE /api/v4/workspaces/current` → `{ok:true}`; workspace admin. Default cannot be deleted. Nonempty sites or scoped resource records produce 409. No cascading content deletion.
- `PUT /api/v4/workspaces/current/members/:userId` `{role:'admin'|'editor'|'viewer'}` → `{ok:true}`; existing user required. Workspace admins cannot demote themselves; instance admins can manage all memberships.
- `DELETE /api/v4/workspaces/current/members/:userId` → `{ok:true}`; workspace admin, same self-removal restriction.
- `GET /api/v4/workspaces/current/sites` → `{items:SiteInstallation[], selectedSiteId}`.
- `POST /api/v4/workspaces/current/sites` `{name}` → SiteInstallation directly, `status:'empty'`, stable `_id`, `workspaceId`, `slot:_id`, `templateNamespace:_id`, `contentGroupId:_id`.

Selection is stateless: send `x-bcms-workspace: <workspaceId>` and optionally `x-bcms-site: <siteId>` on subsequent requests. The `current` endpoint returns the verified selection. UI should use the header selections after full navigation/cache reset as planned. No endpoint trusts a body workspaceId/siteId for management authorization.

Installation workflow: create site → use both headers → POST `/api/v4/presets/import` with existing `{presetId,siteName,includeDemo}`. Nondefault workspace import without a selected site returns 400. Legacy default import without headers still creates/resumes the original default slot and old model names. Existing `/presets/site`, `/plan/:presetId`, pages, releases and `/site-domains` now select through verified context. Explicit workspace admins can use all these administrative paths with USER-only JWTs; preview also preserves existing Template read policy checks for nonadmin members.

Scope failures return 403. Domain IDs belonging to another selected site return 404. Strict mutation bodies reject ownership injection.

## Exact context and repository hooks for Task 4

`backend/src/workspaces/context.ts` has no repository imports:

- `DEFAULT_WORKSPACE = 'default'`.
- `WorkspaceContext`: `{workspaceId, siteId?, actorId, admin, instanceAdmin, role, apiKeyId?}`. `role` is `admin | editor | viewer`; a key is nonadmin and keeps existing API-key permissions.
- `resolveWorkspaceContext(principal, selector, source)` verifies authenticated identity against fresh source workspace/member/site records. Principals are `{userId,roles}` or `{apiKeyId,workspaceId?}`. Do not construct a context from caller headers alone.
- `runWithWorkspace(context, action)` establishes a copied/frozen AsyncLocalStorage context for the action; `workspaceContext()` reads it. No process-wide mutable selected ID and no `enterWith`.
- `workspaceId()` returns current ID or default for legacy/internal calls. **No-context is default, never “all”.**
- `ownerWorkspace(resource)` treats a missing workspaceId as default.
- `workspaceFilter(id = workspaceId())` emits equality for nondefault; default includes explicit default and missing workspaceId. When combining this filter with other `$or` expressions, use `$and` instead of replacing its `$or`.
- `verifiedWorkspace` is the symbol carried in RP pre-handler results. `verifyRequestWorkspace` in `workspaces/auth.ts` attaches it after verification. `_server/rest/controller.ts` runs the handler inside that context. Object spreads in combined RP body/auth checks preserve the symbol.
- `RP.createWorkspaceAdminCheck()` grants current workspace admins (including USER-only members), preserving instance ADMIN/SUDO override. The normal RP JWT/API-key guards now attach context to every authenticated controller route.

`Repo.workspace.methods.fresh(id)` and `Repo.siteInstallation.methods.findFresh(id)` are **intentional raw/fresh identity lookups** used during authentication and public hostname resolution, not user-facing known-ID authorization. Keep a clearly bounded bypass for these when adding generic repository scope. `findSelected()` is the authorized request site lookup; `listWorkspace(id)` should receive a verified ID. Legacy `findDefault/ findDefaultFresh` explicitly target default and are retained for the public local-development compatibility route and internal legacy callers.

`ApiKey.workspaceId` is optional for old data; ApiKeyFactory stamps current workspace after input spread. API-key authentication currently obtains the key by its ID before scope verification; when scoping `Repo.apiKey`, introduce a narrowly named raw authentication lookup for `RPApiKey.verify` rather than making no-context reads global. Regular key list/edit/delete endpoints then need Task 4 scope enforcement.

Task 4 must still:

1. Scope generic repository CRUD, custom `mdb` methods and all shared cache/latch/queue reads across Entry, Template, Media, Widget, Group, languages/status/organizers and API keys. Only Template `findByName` has been scoped in this task because imports need it. TemplateFactory stamps ownership, and import stamps Entry/Template workspace/site metadata; other factories/repositories need the complete Task 4 enforcement. Validate all relationship ownership and forbid body-based moves.
2. Materialize EntryGroup records and uniqueness rules. Each new site has `contentGroupId = site._id`; imported entries have `workspaceId`, `siteId`, `groupId = site.contentGroupId || site._id`. Legacy sites may lack contentGroupId; derive their imported content group from site ID without changing Entry IDs. General legacy entries go to the workspace default group. Include the new EntryGroup/share collections in empty-workspace deletion checks when introduced.
3. Preserve existing Template policies for nonadmin content users while using verified `context.admin` where workspace administration is needed. Current preset/domain/release administration already works for workspace admins.
4. Add signed private-media capabilities, scoped binary/draft access and published-media retention. Release/preview sources currently read media through Repo.media; full metadata/reference isolation is part of Task 4. No claim is made that current global media/binary routes are safe merely because selectors now verify.
5. Carry selectors through MCP internal injection and establish context with the same resolver for sockets; validate entry ownership and restrict event broadcasts/joins. This task does **not** change socket/MCP wiring. Treat those paths as unresolved until Task 4.
6. Public hostname resolution intentionally reads registry/site/release identities across workspaces. Preserve these narrowly controlled reads after generic scoping; ownership validation is mandatory. Domain primary audits still derive scope from their site, and the single-document primary/outbox commit must remain atomic.

## Verification and TDD evidence

RED: `node -r ts-node/register -r tsconfig-paths/register --test src/workspaces/context.test.ts` first failed because the new context module did not exist. After adding the behavioral import case, focused context/import run showed the existing importer fail with **“Another preset is already installed”** for a new blank site. This established the new behavior before importer changes. Initial context implementation also had a compile error allowing undefined AsyncLocalStorage context, corrected before GREEN.

GREEN focused: context/import suite **9/9 passed** after the resolver/namespace implementation. New real Mongo+HTTP integration passed, then passed again after the selected-site import CAS concurrency case was added.

Final relevant suite command (backend cwd; disposable random database names only on localhost27028):

```sh
python3 - <<'PY'
import glob, os, socket, subprocess
sock=socket.socket(); sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]; sock.close()
env={**os.environ, 'STOREFRONT_ENABLED':'true', 'STOREFRONT_HOST':f'localhost:{port}', 'STOREFRONT_GATEWAY_SECRET':'integration-secret', 'STOREFRONT_DOMAIN_SECRET':'domain-secret', 'STOREFRONT_TEST_MONGO':'mongodb://127.0.0.1:27028', 'STOREFRONT_TEST_SSR':'true'}
paths=glob.glob('src/workspaces/*.test.ts')+glob.glob('src/site-domains/*.test.ts')+glob.glob('src/storefront/*.test.ts')+glob.glob('src/presets/*.test.ts')
raise SystemExit(subprocess.run(['node','-r','ts-node/register','-r','tsconfig-paths/register','--test',*paths],env=env).returncode)
PY
npm run build:noEmit
```

Result: **64 tests, 64 pass, 0 fail, 0 skipped**. Includes existing D1 durable outbox failure/replay/stale-write regression, legacy publication lifecycle, built Nuxt SSR domain/canonical/alias checks, workspace HTTP auth/install/release/domain integration and concurrency isolation. Full captured TAP is `/tmp/cms-task3-suite.log`. Backend typecheck passed. `git diff --check` passed.

Self-review then strengthened empty-workspace deletion to check scoped existing resources, with rename/delete HTTP coverage added. Final focused rerun:

```sh
STOREFRONT_ENABLED=true STOREFRONT_DOMAIN_SECRET=test-secret \
STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 \
node -r ts-node/register -r tsconfig-paths/register --test src/workspaces/integration.test.ts
npm run build:noEmit
```

Result: **1/1 integration passing**, backend typecheck passing. No duplicate broad rerun after this localized change.

Integration exercises old index migration and unchanged legacy site/template/prop IDs, duplicate names across workspaces but rejection within one, member CRUD/revocation and viewer denial, forged selectors, same/different presets across workspaces/sites, simultaneous selected-site installation, independent publication/rollback and foreign rollback rejection, workspace-owned public release resolution, wrong release workspace rejection, stale import/draft operational pointer preservation, API-key pinning and twelve interleaved authenticated requests.

## Files and self-review

New `backend/src/workspaces/`: context.ts, auth.ts, repo.ts, controller.ts, migration.ts, context.test.ts, integration.test.ts. Modified central controller/RP/repository initialization hooks; main/Repo registration; API-key schema/factory; Template schema/factory/findByName/index migration; Entry ownership metadata; preset site schema/repo/import/controllers/releases; domain model/service/source/controller/repo ownership; storefront preview/public resolution. Existing integration setup now initializes WorkspaceRepo.

Self-review checked that all preserved D1 operational fields stay excluded, ownership identity cannot be edited by draft data, namespace remains stable across display-name changes, migration builds replacement constraints first, role selectors cannot elevate, raw lookups are limited to documented server identity/public resolution hooks, and default compatibility does not choose a site in another workspace. Added the import claim CAS and empty-workspace resource check during review. No subagents, deployments, pushes, merges, DNS changes, or Docker/service changes were made. UI/types regeneration remains Task 6; comprehensive end-to-end security validation follows Task 4–7.

## Review fix round 1 — durable workspace creation/deletion coordination

The review identified a valid lifecycle race in delete-empty: earlier request authorization did not prevent site insertion after the emptiness checks or deletion. The fix now coordinates those operations through atomic writes on the same Workspace document, without a cross-collection transaction or an expiring lock.

`Workspace` adds optional `lifecycleRevision:number` and `pendingCreations:WorkspaceCreationReservation[]`. A reservation records `{id,kind,resourceId,actorId,createdAt}`. `Repo.workspace.methods.reserveCreation(workspaceId,reservation)` atomically increments the revision and pushes the reservation only if the workspace exists. Site creation holds that durable reservation through the acknowledged insert. `completeCreation(workspaceId,reservationId)` atomically pulls only that reservation and increments the revision; repeated completion is idempotent. Missing fields on old workspace documents remain supported.

Deletion reads an idle workspace/revision, performs the existing emptiness checks, and finishes with `deleteIfIdle(workspaceId,observedRevision)`: a single Mongo deletion matching the exact revision and no pending creation reservations. Default workspace deletion is rejected inside this method as well as at the route. Any reservation acquired after the observed revision invalidates the delete CAS, even if that creation finishes and clears its reservation before the CAS. If deletion commits first, a later reservation cannot match the removed workspace and creation fails before writing the site. Thus only one operation can win the race; deletion conflicts use HTTP409.

### New mandatory Task 4 / Task 5 lifecycle interface

`backend/src/workspaces/lifecycle.ts` exports:

```ts
withWorkspaceCreation<T>(
    resource: { kind: string; resourceId: string },
    action: () => Promise<T>,
): Promise<T>
```

Call this **inside the destination's verified workspace context**, after authorization/validation and before the first persisted resource. Await all persistence and cleanup inside `action`; no detached/background writes may continue after the promise settles. New nondefault site creation already uses it. The default workspace bypasses reservations because it can never be deleted. The helper itself does not establish membership authorization.

Task 4 must use this same protocol for all resource creation/movement paths: generic add/addMany, custom Mongo writers, EntryGroup creation, resource import/copy, filesystem-backed resource creation and destination moves. A multi-write operation needs an outer reservation across the whole operation, even when inner repository adds also reserve individually. Task 5 copy acceptance must hold a destination reservation across all staged writes/cleanup. Add their new resource collections to workspace emptiness checks. Do not use the generic Workspace `deleteById` in user-facing deletion or allow callers to replace lifecycle fields.

### Interrupted-write recovery semantics

Reservations **never expire** and are not cleared in `finally`. If `action` rejects, the reservation remains, because a timed-out/rejected client operation does not prove its database/storage write cannot still commit. Failed acquisition never runs the action. If action succeeds but acknowledgement fails, the helper retains the reservation, logs deferred acknowledgement and returns the successful creation result; it does not misreport an already committed resource as failed.

Recovery is an explicit privileged operator/server operation using the recorded workspace/reservation ID and the idempotent `completeCreation` method. There is no new public recovery endpoint or background expiry job. **Before clearing an interrupted reservation, stop/fence the original writer and establish that every already-issued database/storage operation has completed or been cancelled and cannot later commit.** Merely waiting, checking `createdAt`, observing an HTTP error, or seeing a process exit is insufficient if a previously issued write may remain pending on the server. Inspect the recorded resource ID and finish required persistence/cleanup under the retained reservation, then acknowledge it. If safety cannot be established, leave the reservation and deletion blocked. Normal successful acknowledgements can be retried when the caller knows its full write operation completed.

### Evidence

Applied receiving-code-review workflow and first added three deterministic Mongo+HTTP barrier regressions against the previous implementation. After correcting the test fixture's Node type annotation, the actual RED run showed **3/3 failures**, all unsafe HTTP200 where HTTP409 was required:

1. Site creation pauses at insert after acquiring permission; deletion runs while creation is pending.
2. Creation pauses after reading an existing workspace during authorization; deletion commits before creation reaches reservation/persistence.
3. Deletion pauses after reading an empty site list; creation fully commits before deletion resumes and attempts its final removal.

All three became GREEN after the durable reservation/revision implementation. Added a fourth real-Mongo regression proving failed creation leaves a durable reservation, aged timestamps and repository restart do not remove it, and explicit repeated recovery allows idle deletion once the test writer is known to have stopped without issuing any insert.

Final focused command from backend:

```sh
STOREFRONT_ENABLED=true STOREFRONT_DOMAIN_SECRET=test-secret \
STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 \
node -r ts-node/register -r tsconfig-paths/register --test \
src/workspaces/context.test.ts src/workspaces/lifecycle.test.ts src/workspaces/integration.test.ts
npm run build:noEmit
```

Result: **7/7 pass, 0 failures, 0 skipped**; backend typecheck passed, `git diff --check` passed. No broad rerun, external DNS or service changes. The existing 64-test baseline remains the prior full-suite evidence. Controller, resolver and Workspace repository were reformatted to normal multiline style as requested by the minor review finding. Self-review confirmed that completion increments the revision, stale authorization cannot bypass reservation acquisition, failure paths retain durable guards, and no TTL/lease can release a still-active writer.
