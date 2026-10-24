# Task 4 — content isolation, EntryGroups and media/socket boundaries

Implementation complete for review on October 24, 2026. Commit SHA is recorded in the agent handoff. No push, merge, deployment, real DNS changes, existing Docker service changes, or extra worktree were performed.

## Repository and authorization contract

- Ordinary Mongo repositories now receive a scoped collection adapter. Legacy untagged documents belong only to `default`; nondefault contexts cannot read, count, mutate or delete them. User, Workspace and instance Backup repositories explicitly remain instance-level. Backup routes still require a fresh instance ADMIN identity; workspace-admin USER tokens are not elevated for instance backup/user operations.
- Generic reads and custom collection reads combine workspace scope with existing Template CRUD grants (Entry uses its `templateId`) and Media policy. Viewer writes are denied. Workspace administrators can administer their own content with USER JWTs through content-specific route guards. JWT identity/policy and membership come from fresh user/workspace records. API key authentication uses a narrowly named raw identity lookup and key ownership remains authoritative.
- Repository caches, custom method closures/latches and queues are partitioned by workspace, actor, role and grants. Mutations invalidate caches and recreate custom method closures across all scope states. Generic cached reads return copies so failed request mutations cannot poison later cached reads. Raw authentication and public domain/site/Release-media identity lookups are separately named.
- Writes reject mismatched ownership and request body `workspaceId`. Generic/bulk creation and updates reserve the workspace through Task 3 `withWorkspaceCreation`; prepare hooks execute inside the outer reservation. Import has a whole-import reservation; upload has a whole-file-write reservation. Rejected/uncertain writes retain reservations, without timeout cleanup, following the Task 3 recovery contract.
- Reference checks cover Template, Entry, Media, Widget and structured Group props, nested Group/Widget values and rich-text widget nodes; media directories and template organizers validate parent ownership/cycles. Entry paths verify both template ID and entry ID. Entry parsed/lite output includes workspace/site/group metadata. Template title property identity cannot be changed while its entries exist.
- Preset import persists model skeletons before reference definitions, so forward references resolve through scoped repositories. Demo entries use their site content group.

## EntryGroup API and uniqueness contract

EntryGroup is separate from structured CMS Group. Routes use verified `x-bcms-workspace` and optional `x-bcms-site`:

| Method | Route | Result / access |
| --- | --- | --- |
| GET | `/api/v4/entry-groups/` | `{items, defaultGroupId}`; authorized scoped readers |
| POST | `/api/v4/entry-groups/` | Body `{name}`; workspace admin; returns group |
| PUT | `/api/v4/entry-groups/:groupId` | Body `{name}`; workspace admin; returns group |
| DELETE | `/api/v4/entry-groups/:groupId` | `{removed}`; workspace admin; refuses default/nonempty/pending-write group |
| PUT | `/api/v4/entry-groups/:groupId/entries/:entryId` | `{item}`; existing Entry read+put grant; validates destination and uniqueness |

Existing Entry create and update bodies accept optional `groupId`; omission on create selects `default:<workspaceId>`. Default groups are created on demand. Group list can initially return the default ID without a stored item. Site demo group IDs use `site.contentGroupId || site._id`.

Entry title keys are JSON `[language, title.normalize('NFKC').trim().toLowerCase()]`, resolving the actual Template property ID by its `title` name. Unique Mongo multikey index `workspace_group_language_title_unique` on `(workspaceId, groupId, titleKeys)` enforces cross-Template uniqueness across concurrent create/edit/move/import/copy writes. Duplicate errors are HTTP 409. Missing legacy title keys are excluded until migration; ordinary writes recompute keys and never trust supplied keys.

Group writes use durable UUID permits and a revision, held through acknowledged Entry persistence. Deletion checks occupancy then revision/no-pending-permit CAS. Rejected/uncertain writes retain the permit; recovery must establish the original writer cannot later commit, and must not clear by age. Default group cleanup during empty-workspace deletion uses the same group CAS followed by Task 3 workspace revision CAS.

## Migration/operator contract

`backend/src/entry-groups/migration.ts` runs before the Entry unique index is installed. It computes all intended groups/title keys and detects conflicts before mutation. It preserves Entry/Template/Prop/media/site IDs, does not rename titles, derives preset demo site groups before conflict analysis, and refuses group IDs claimed by different workspaces. Repeated successful runs are idempotent in resulting ownership/group/name data. Migration writes use the Task 3 workspace reservation helper.

Read-only preview from `backend/`:

```sh
BCMS_ENTRY_GROUP_MIGRATION_MONGO='mongodb://127.0.0.1:27028/explicit_database' node -r ts-node/register -r tsconfig-paths/register src/entry-groups/preview.ts
```

The operator must supply an explicit URI including the database. Output is `{entries, conflicts}` and does not write. Resolve conflicts explicitly before startup migration; no automatic rename or conflict mutation occurs. Startup migration assumes deployment writers are quiesced; it is not an online multi-process migration protocol.

## Media contract for Tasks 5 and 6

- Authorized Media metadata adds optional `accessToken` and `accessTokenExpiresAt` (epoch ms). HMAC capabilities bind media ID, workspace and actor/API key and expire after 15 minutes. Binary access rechecks fresh identity, membership and media policy. Capabilities are response-only and removed before media persistence.
- Synchronous SDK `media.toUri` appends `?cap=...` (or `&cap=...` alongside transform data) from metadata. UI/client metadata caches refresh on the next get/getAll when expiry is within one minute. Task 6 should refresh visible long-lived editor images when capabilities expire; synchronous `toUri` itself does not perform a network refresh. Client `toUri(id,filename)` requires prior authorized metadata retrieval for a private capability; it no longer puts the long-lived API key in generated image URLs.
- Authorized previews sign their media URLs. Release building strips capability fields before building immutable stable URLs. No JWT is serialized in a Release.
- Binary GET accepts normal verified Authorization/API-key access, a valid `cap`, or a retained published Release reference. Anonymous workspace headers do not select ownership. Private response caching is `private, no-store`; retained public binaries use a short public cache.
- `Repo.storefrontRelease.methods.findRetainedMediaReference(mediaId)` returns validated `{workspaceId,siteId}` only for a snapshot URL reference whose envelope/snapshot/site ownership agrees and whose ID remains in `publishedReleaseIds` (legacy fallback `currentReleaseId`). It is a raw, bounded-purpose identity lookup; Task 5 can reuse it to protect physical retention. `Repo.media.methods.findForAuthorizedBinary(id,workspaceId)` is only called after that authorization.
- Upload token remains an opaque `token` response consumed once by `/media/create/file`; it now stores verified actor/workspace context and expiry. Upload revalidates identity/membership/grants, rejects foreign/non-directory parents, and reserves the workspace before storage persistence.
- Physical retained-media deletion protection is Task 5 scope and is not claimed here.

## Socket and MCP contract for Task 6

- Socket URL remains `/api/v4/socket?token=...`. Add `workspaceId=<id>` and optional `siteId=<id>` (aliases `x-bcms-workspace` and `x-bcms-site` are accepted). Omitted selectors mean default only. API key token syntax remains `apikey_<id>.<secret>`.
- Handshake checks token/key, fresh user/key identity, membership, site ownership and policy. Incoming Entry synchronization runs in that verified context, checks Entry ownership/read policy, requires put permission for content updates/responses, validates explicit Media/Entry references and full entry synchronization payload references, and overwrites sender identity fields.
- Direct sync delivery checks the recipient again, its workspace, current Entry read access and channel participation. Resource broadcasts check fresh membership, source/recipient workspace and Template/Media read policy; instance user/backup/key events remain instance-admin-only. Revoked recipients are closed. Existing Yjs binary delta semantics remain opaque, but persistence still passes repository reference/name validation.
- MCP validates selectors against the same fresh principal resolution before constructing its server. Every REST inject forwards authorization plus workspace/site headers; every injected route revalidates scope and permissions.

## Verification and limitations

Prior to the subsequent controller instruction prohibiting new tests, observed red/green evidence was recorded:

- `content-isolation.test.ts`: red observed a cached foreign workspace media object returned; green scoped normal/custom lookup, count, forged ownership, update/delete and legacy default-only checks.
- `names.test.ts`: red observed missing duplicate rejection; green NFKC/case normalization across Templates, concurrent duplicate insertion (one succeeds), foreign Template rejection and cross-workspace same title.
- Exact earlier focused run: `STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 node -r ts-node/register -r tsconfig-paths/register --test src/workspaces/names.test.ts src/workspaces/content-isolation.test.ts` from backend; 2 passed, 0 failed, 0 skipped. Databases were uniquely named and each test dropped only its own database.

No tests were added or run after the controller's explicit instruction. Those two earlier passes do not validate the later media/socket/controller/migration changes. Existing Task 3 fixture initialization edits adding EntryGroup were preserved; broader integration tests were not rerun and may need fresh-auth fixtures for the newly required real User records.

Backend `npm run build:noEmit` passed after main implementation. Backend declaration-only compilation passed. Final backend/UI check results are appended below. UI initially failed because its ignored `backend/types` declarations were stale; they were regenerated locally. Client `npm run build:noEmit` could not start (`tsc: command not found`) because its package dependencies are absent; no dependency installation was performed. No runtime WebSocket, private-media, Release retention, migration, route, or UI smoke verification is claimed for these final changes.

Static self-review checked collection bypass calls, named raw lookups, import reference ordering, title index/move flow, group/workspace deletion races, Media file policy before physical writes/deletes, and no capability serialization into Releases. Follow-up review should prioritize media/socket runtime behavior and migration compatibility under real legacy data.

Final check results: backend `npm run build:noEmit` exit 0; UI `npm run type-check` exit 0 after regenerating ignored backend declarations; `git diff --check` exit 0. Client compiler availability limitation remains as described above. Implementation and report are ready for the independent review gate.
