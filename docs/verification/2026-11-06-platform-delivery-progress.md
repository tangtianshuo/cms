# Platform delivery execution record

Execution dates: 2026-11-06–2026-11-07 (Asia/Shanghai).

## Scope and isolation

The 25-task master plan is being executed in four dedicated managed worktrees. Original CMS/Templates pending changes and architecture source worktrees are preserved. A fingerprint comparison of 154 source files found no changes after A1 implementation. No external publication, push, production cutover or production migration has been performed.

The original plan/specification baseline is preserved in CMS commit `b614671`.

## A1 — Gateway integration accepted

Gateway commits:

- `a3a169e0e7e5e31780d4190129bf672e634815e3`: contract/artifact/domain migrations and independent traffic integration.
- `c3d6ee9e900fe4abea46885d1f81809ab1d2efc0`: repeated deployment identity, verified immutable snapshot access, canonical-host forwarding and truthful deployed-image identity.

The worker no longer binds the public traffic port. A separate traffic process must be launched in subsequent runtime configuration. The implicit `GATEWAY_LOCAL_IMAGE_DIGEST` AeroFrame substitution was removed; test deployments must pin the image actually being run.

Validation:

| Check | Result | Boundary |
| --- | --- | --- |
| CMS backend build / expected initial contract failure | Reproduced | Gateway originally lacked the contract validator export |
| Gateway typecheck / build | Passed | Integration code and production control build |
| Real isolated PostgreSQL suite before review fixes | 195 passed, zero skipped | Nine migrations applied; disposable database only |
| Focused tests after four review fixes | 123 passed, zero skipped | Control 63, worker 57, traffic 3 |
| Linux artifact permission test | Passed | Root-owned legacy 0600 file reconciled after integrity validation; UID 10001 read-only mount succeeds; private directory/write protection retained |
| Two publications, rollback, failed finalization | Passed | Actual finalizer plus both authority state readers |
| No-primary domain selection through traffic | Passed | Canonical 200; alias 301; no self-loop |
| Independent review / scoped re-review | Approved after fixes | Four P1 findings addressed; no new Important/Critical findings |
| Target Gateway with read-only Templates source contract roundtrip | Passed | Supporting evidence only |
| All-target contract roundtrip | Passed in A2 | Real CMS projection → target Gateway validation → both new Templates runtimes |

The initial DB-free test invocation skipped 38 database tests. Those skips were not treated as passes; the real SQL runner subsequently exercised them. The 195 and 123 counts describe different revision/test scopes and are not added together as unique cases.

A1 does not prove complete template outage behavior, real preview delivery, automatic provisioning, full version locking, production acceptance or human 10-minute usability. These remain the later plan tasks.

## A2 — Immutable template integration accepted

AeroFrame 1.0.4 and FireGuard 1.0.1 combine the preserved contract runtime and unified preview changes. Old published directories remain byte-identical (81 files). Source fingerprint comparison again found all 154 protected files unchanged.

Commits:

- Templates `c0e2e1713dc6745fc7390da706bd77423ea2e19d`: immutable version integration.
- Templates `e1cb6c682c7add5ad2880bc7c45f16da9f841b63`: media artifact resolution and dynamic route metadata.
- CMS `0d29068629ed30ddc8a60143210208d28e7ae0f1`: site-authorized media capability projection and declared dynamic draft routes.

Public rendering reads verified local artifacts. Private preview retains authorized CMS media capabilities. Layout precedence and strict unknown-value validation are preserved. Both manifests now declare product/content slug patterns, with real CMS creation/update regressions and reserved-path rejection. Independent review's two findings were fixed and scoped re-review approved.

| Check after review fixes | Result | Boundary |
| --- | --- | --- |
| Actual CMS/Gateway roundtrip and built HTTP runtimes | 16 passed, zero skipped | Includes media URLs/bytes, layout precedence, invalid references, concrete draft routes and zero control requests |
| Storefront render/preview tests | 20 passed per template, zero skipped | Both new versions |
| Templates root suite | 39 passed, 1 gated legacy runtime skip | Skip not counted as passing |
| Expanded CMS backend regression | 45 passed, 1 MongoDB integration skip | Mongo lifecycle test not run in this scope |
| CMS UI regressions | 9 passed, zero skipped | Publication/section behavior |
| Type checking, manifests, production and static preview builds | Passed | Local builds only |
| Independent scoped re-review | Approved | Both findings addressed; no new Critical/Important issues |

CMS commit-hook lint reported zero errors and 234 non-null-assertion warnings; this is not represented as a warning-free run. Tests with different scopes/revisions are not summed as unique cases. Current generated storefront outputs are production builds.

No new template registry records, OCI images or preview bundles were externally published. Browser delivery and final lock remain B2/B3/A4 acceptance work.

## A3 — Independent intake accepted

Commits:

- Gateway `ca3c543839918928ad724bf30d4fa05e5e90a93e`: independent HTTP/server workspace, trusted origins/proxies, atomic lead quota, management routes and worker environment propagation.
- Gateway `f71bbd0007c880a0b8821a90cbe26592a2a3c53a`: reject empty inquiries and malformed visitor/session identifiers as client errors.
- Templates `57b12336c98dec0082dc849ab97bc5571565892f`: both new versions use the independent intake origin, one analytics plugin and retryable forms that retain input.
- CMS `513b994a5711d2b27c78622ee3486057183de3aa`: independent compose service and disposable real-process isolation runner.

Intake derives workspace/site ownership and all enabled domains from PostgreSQL, requires an allowed Origin, rejects management credentials, bounds JSON to 64 KiB and uses socket IP unless an explicitly trusted proxy supplies the chain. Lead quota is atomic for each site/IP; duplicate accepted keys remain successful at capacity. The worker passes only its trusted configured public ingest origin; missing configuration disables public submission.

| Check | Result | Revision/scope |
| --- | --- | --- |
| Complete Gateway suite against random migrated database | 220 passed, 1 Linux-only mount skip | Before the atomic quota amendment; not a full rerun of final code |
| Final intake tests after both review fixes | 23 passed, zero skipped | Real PostgreSQL, HTTP/socket/proxy, concurrent quota, dedupe and malformed input |
| Worker Docker adapter | 13 passed, zero skipped | Trusted intake configuration and ignored candidate override |
| Template client behavior | 4 passed, zero skipped | Both versions, analytics and retained-input retry |
| Cross-repository and built HTTP contract | 16 passed, zero skipped | Real CMS → Gateway → both new Templates |
| Templates root | 43 passed, 1 legacy runtime skip | Skip not counted passing |
| Production builds and compose configuration | Passed | Ingest/control/worker and both Nuxt runtimes; compose validation |
| Independent review and scoped follow-up | Approved | Two minor validator defects fixed; no remaining findings |

The actual process drill ran production control, compiled ingest and both compiled public template servers with separate PIDs. After control exited, both sites still received actual lead/event 202 responses. After ingest exited, the same two public URLs returned 200 with identical HTML hashes. Final cleanup independently confirmed no remaining child PIDs and no random test database. This drill preceded the small validator follow-up; the follow-up reran all 23 affected intake tests and the production ingest build.

The complete Docker/traffic/TLS outage matrix belongs to A4. Shared service management authorization remains C1. Browser interaction, external publication and production acceptance are not claimed here. The 154 protected source fingerprints remain unchanged.

## A4 — Local implementation accepted; formal acceptance pending

Commits: CMS `d68f1943160259f82468c09d18dd8a0eed854412` and `c1ab0d1ddb0d9e6007f9b3ab089e6e9473cb7c23`; Gateway `58e615f10cc42cbffb711de65130d9ab9879de7a`; Templates `ed63e4e814d028f1ca64af98b2a1da37138a649c`.

Four exact-source repositories produced five local Docker images. Two template runtimes each survived actual CMS, control, worker and ingest stops: eight scenarios preserved seven public responses and deployment authority. Separate local publication covered draft isolation, rollback, idempotency, conflicts, candidate artifact-integrity failure and worker restart. This is not evidence of an unhealthy-runtime injection or Internet DNS/TLS acceptance.

The real Docker run exposed and corrected the strict worker Env consumer mismatch. Both new templates gained artifact-only sitemaps. Recorded checks include Gateway 228 passes/1 Linux-only skip, actual cross-repository and built-HTTP contract 16 passes, sitemap 2 passes and Docker adapter/client 29 passes. These scopes are not summed. All owned running resources were removed and the two disposable A1 database services restored; 154 protected source fingerprints remained unchanged.

Independent review found stale image evidence, failed cleanup acceptance and formal/local evidence confusion. Fix regressions passed 10/10 with zero skips, historical evidence passed the stricter identity validation, and the archive test passed from a fresh cwd. Scoped re-review closed all three important and both minor findings. Formal mode now exits nonzero until authentic public-chain evidence is wired; a format-valid lock cannot turn local proof into formal acceptance.

The historical CMS image accurately records source `0db4e29eae9b06f0c5479ce2fe8f7ecc577a4917`; later tooling commits do not relabel it. Local Docker configuration IDs are not public OCI manifest digests. Full public CMS→control→worker execution, final PlatformLock and formal evidence consumption await B2. A4 remains unchecked overall.

## B1 — Exact-version CMS preview accepted

CMS `a3bf2ed42e5161b2563221cac50bda6fc7ebed9f` connects the authorized installed version to the single resolver and guards iframe delivery by origin, window, template version and protocol. Missing renderer and temporary service failure remain distinct; a configured service cannot silently fall back. Switching sites clears the old descriptor and rejects stale messages while same-site edits retain a valid handshake.

Templates `0db7ce5f309cd1c8e7bf7d52553e0fa34d7da84e` adds protocol 1 to the existing ready producers in both unpublished versions. Original sources and old published versions were preserved.

Final focused checks: backend 20/20, UI 20/20, Templates protocol and actual CMS/Gateway/Templates projection 8/8, all zero skipped; backend/UI type checks passed. UI checking required the existing generated backend type declarations. Independent review approved specification and quality, with one deferred minor cleanup for new test non-null assertions. Backend lint reported zero errors and 238 warnings, including existing warnings; no pristine-lint claim. Source fingerprints: 154 unchanged.

The Vue host-renderer tests are executable component tests, not real browser evidence. Final bundle/registry identity, embedding policy, browser acceptance and canvas selection remain B2/B3/B4/B7 work.

## B3 — Early browser foundation accepted; full acceptance pending

CMS `5177ed1b9adc290c5e2ddb6842c3481c3f3a7c7c` adds pinned Playwright, real login fixtures and isolated current-source CMS/Preview setup. `76a7ecd28d589dc51b80dfe86e2123b2ec8df2d6` fixes process descendant cleanup and startup cancellation found by independent review.

Real desktop/mobile login and unavailable-renderer baseline: 4/4. Live security/failure checks: 6/6. Lifecycle fix checks: 6/6, including exited wrappers, active build/run cancellation, the startup signal race and the actual Node/npx/Playwright/Chromium chain; all 11 observed owned processes exited and an unrelated control survived. A fresh normal browser replay passed 4/4 after the fix. Cleanup confirmed no disposable databases, credential/auth/build residue or occupied test ports; A1 services remain healthy. Scoped re-review approved, with the inherited color warning deferred.

The baseline uses the actual built-in AeroFrame 1.0.0 and an empty local Preview registry. It does not count toward new-version/two-template acceptance. Explicit foundation mode labels its output local-only and incomplete; the default acceptance path exits nonzero. Credentials stay outside retained evidence; safe screenshots replace tracing in this early stage, and credential-safe trace remains deferred. The helper supports documented POSIX command chains, not arbitrary detached daemons. Source fingerprints remain 154 unchanged.

## B4 — Local controls accepted; public comparison pending

CMS commits `86e88a63ef2c0bef4644539f763ddf939e6c61f6`, `fa6b332e8fe439d08476bd228267ade357a7b156` and `67c1a5ed739b45d3618da1740c8968631d983ba0`; Templates commits `4e9d2299ff6fe203ca8887bd83273f01a1c12705`, `4a6eb28c7a2af993dd39dad17b44e3bddb7265f8` and `e24ce0833e39aa6423ecc471140d486f3d4e1c4b`.

Declared controls replace section JSON editing, preserve structured/unknown values and use existing media selection. Authoritative normalized-layout validation rejects unauthorized media/references and invalid declared values before persistence. Actual Vue reactive layouts can be edited without clone errors; the draft overlay updates the renderer's authoritative page layout. Both new templates implement guarded canvas selection and preview-build root routing while retaining public routes.

Independent review found numeric UI/server/renderer disagreement, valid numeric input marked invalid, and a missing rendered heading marker. The first fix carries optional minimum/integer declarations through all boundaries while preserving unconstrained zero/negative/fraction values. A second review found native numeric validation could bypass the linked error summary; the second fix orders section summary before native metadata validation. Both scoped re-reviews are recorded, and the local stage is approved with no remaining Critical/Important finding.

Initial AeroFrame browser matrix passed 8/8. FireGuard's first run remains 7/8, followed by a passing focused 4/4 after fixture navigation synchronization. Fix-one focused results: UI 8/8, backend 14/14, actual manifest/UI/server/two-renderer boundary 2/2, Templates 34/34; collection browser cases 2/2 per template. Final submission-order regressions passed AeroFrame 12/12 and FireGuard 6/6, covering desktop/390px, visible/hidden invalid fields, summary links, retained input, repair/save/refresh and native metadata checks. Counts cover different scopes and are not summed. Normal UI hooks passed; prior backend lint retains 238 warnings/zero errors. Earlier test skips and harness noise remain explicit, not acceptance passes.

The actual new-version bundles were built from Templates `e24ce0833e39aa6423ecc471140d486f3d4e1c4b`; local archive identities are not OCI manifests. Canonical publication/deployed comparison and actual selected-image pixels remain B2/final B3 obligations: the local HTTP image URL is blocked by existing HTTPS-only image CSP. No production policy was relaxed. The requested historical pre-change JSON browser capture was missed and remains an evidence gap. Complex editing remains B6; safe retained tracing remains final B3. B4 stays unchecked overall until its remaining public comparison is completed. Protected original-source fingerprints remain 154 unchanged.

## B5 — Unified content entry and workspace accepted

CMS `c3108088d8f2d7e4438bf2ba228725eebb63ffad` and fix `53100d4f84ffdb9b068eb58c091637523ef31e5d` consolidate legacy bookmarks, lists, sidebar, workbench, onboarding and settings locators into one ContentWorkspace. A full local Entry draft and one mounted iframe survive content/sections/page panel changes. Historical uninstalled/unbound content remains editable; no EntrySync or second writable EntryView is introduced.

Necessary adopted-path prerequisites include optional generic Entry version forwarding to existing atomic CAS; selected-site ownership/capability checks on consumed Entry/template routes and lists; full Entry createPage payloads with trusted server identity and deterministic retry consistency; semantic nested site-resource authorization; and shared bound-content media candidate/confirmation rules. Local text initialization, own-blueprint path collision and verified dynamic preview-path defects were corrected. Old unversioned API and legitimate historical resource compatibility remain explicit.

Initial selected evidence includes route 9/9, affected UI 28/28, page/release/create 35/35, repository CAS 1/1, site-reference HTTP 2/2, picker 6/6, form 8/8, final locator 2/2 and FireGuard entry/validation 10/10. These are distinct scopes/revisions, not a summed final whole-suite result. Actual negative controls exposed cross-site reads/writes, stale writes, nested reference acceptance and unintended picker submission before the fixes.

Independent review found four regressions: singleton sidebar identity, post-save page rebinding, stale loader global/route side effects, and missing independent settings leave protection. The fix restores strict target mapping, exact internal navigation with explicit failure/retry, immutable lifetime/context checks and settings leave/update/unload/busy guards. Browser RED evidence covers every original defect; the first fix matrix remains 9 passed/1 failed, followed by final settings 2/2 and retired settings callback 2/2. UI 29/29 and backend 22/22 passed; final normal lint/typecheck hooks passed with 237 backend warnings and zero errors. Scoped independent re-review closed all four Important and two Minor findings with no new breakage. Controller checked the report, logs, commit scope and clean status; 154 protected source fingerprints were unchanged before review.

The failed settings case exposed an existing operations-media roundtrip defect: absent socialImage/favicon become null and a subsequent ordinary settings request returns 400. Equivalent prior initialization/request logic also fails. Legal-request guard tests explicitly choose the existing unset controls first; they do not prove ordinary repeated-save correctness. This unresolved defect is carried into final integration/D1 and must be repaired before platform acceptance. Its precise database conversion mechanism has not been independently instrumented.

B5 accepts entry/component convergence only. B6 structured adapters, B7 unified session/unsaved preview/partial saves, final FireGuard validation after later changes, canonical publication and image pixels remain their later gates. No external push/publication or production change occurred.

## B6 — Structured content accepted

CMS `7d6fe77e27ee318eb517cac6b22f0b70bcbe1b7c` and fix `bea75a36f342c487e9dbc80ea33548f661a3441c` add the production StructuredField adapter to the existing local Entry draft. Metadata rich text, declared arrays/groups/widgets and section rich nodes retain structure; unknown schema-less section values stay readonly and required unavailable values block creation. Generic and Studio writes share structural validation and actual resource authorization. Rich links carry site/lifetime context through the global media picker. Controlled editor updates retain selection, and nested dialogs handle only the active layer's cancellation.

The initial independent review found three Important gaps: known node types with invalid tree grammar were accepted; widgets inside rich text retained old string/path assumptions that prevented edits from reaching the draft; unbound historical content bypassed link workspace/read authorization. Fix1 adds parent/child rules, repairs canonical/string widget handling and relative paths with explicit array transactions, and validates internal links at the workspace repository write boundary. Site constraints remain additional to workspace/permission checks. No historical content is assigned a fabricated site.

Initial evidence: UI 13/13, backend 35/35, full AeroFrame B6 browser 14/14, FireGuard focused 4/4; selected B4/B5 controls 6/6 were inside a retained mixed 16/20 run, not a passing combined run. Fix evidence: backend 7/7 (earlier affected compatibility scope 18/18), actual Vue/TipTap rich-widget consumers 5/5, actual AeroFrame/FireGuard desktop/mobile 4/4 each. Four invalid tree examples through generic create/update, Studio and section writes return 400 with stored Entry/site unchanged; empty and lawful nested controls succeed. Real HTTP plus Mongo coverage proves 10 foreign-workspace/unreadable/forged-reference denials with no persistence and four lawful unbound-content controls. Local Yjs provider/remote update compatibility is tested with an in-memory transport; two-user network acceptance is not claimed.

Build:types, backend/UI type checks and normal commit hooks passed with 237 historical backend warnings/zero errors. Color-variable warnings remain a deferred Minor; output is not described as pristine. Original protected-source fingerprint check still reports 154 unchanged. The fix report distinguishes actual RED from fixture failures and preserves precise command/output/source provenance. Scoped independent re-review closed I1–I3 with no new Critical/Important findings; B6 is accepted with the documented Minor noise baseline. Controller checked the report, exact logs, commit scope and source fingerprints.

B7 retains two mandatory dependencies: both new Templates need safe rich-node DOM rendering (current projection flattens marks/lists/hr), and a normal structured save of a nonexistent internal route can return 200 before Snapshot rejects preview. The lawful `/` test control does not fix the latter; B7 must use authoritative complete-site overlay validation with a locatable error and last-valid canvas. B6 storage fidelity is not formatted template/public rendering evidence. Existing settings repeated-save/null handling, unified partial saves/live preview, final B2 bundles and B3/public/image-pixel acceptance remain later gates.

## B7 — Unified drafts and reliable save continuation accepted locally

CMS implementation `830614fa6ad3d34085c9300a86b436f6cf6cedda`, translation closure `62aee6684f594e483304a47b57a5da43c18ac9f4`, final fixture `6c2b0dde035c4151df26d86da5c821d4ef7d8a20`, and reviewed fix `f2db53e13c44fbc217c425129c9baeef4eb61ca0`; Templates `6a2fd46a2c8d4bca93365bac4cffed831b0eb7c1` contains the five B7 renderer/contract commits. Gateway and Preview sources are unchanged.

One local session owns full Entry, page and settings drafts. Authorized no-store POST preview validates complete overlays in memory, rejects stale responses and retains a clearly labelled last-valid canvas. Sequential saves acknowledge only successful parts. First-create page/SEO/section edits survive the single creation operation; server-owned site and Entry version receipts protect replay and later continuation. Valid translations can be saved incrementally, while strict preview remains unavailable until required translations exist; invalid fields, bindings, routes and resources remain errors. The ordinary repeated-settings-save defect from B5 is now closed by precise optional-media normalization and actual Mongo-backed two-save/canvas checks, without a manual clearing workaround.

Both unpublished templates share safe rich-node rendering for declared body slots, including mapped/default Entry body precedence and nested textual/rich widget values. Actual CMS projection → Gateway validation → public/preview renderer tests passed 8/8. Final pre-review focused scope passed backend49/UI22; each template's desktop/mobile matrix passed78 with2 explicit public-URL skips and0 failures at CMS6c2b0dd/Templates6a2fd46. These separate scopes are not summed, and skips are not passes.

Independent review found stale page cache after a successful save and missing Entry CAS after first-create/partial-settings failure; it also required actual mobile focus evidence. Fix1 merges the exact page receipt, carries the actual created or explicitly confirmed binding Entry version, and restores native/rich caret only on explicit return from canvas. Actual save-switch-return-save and create→settings400/409/unknown→edit→retry controls passed, preserving other-language content. Pointer/keyboard mobile controls verify caret, mounted iframe, no panel-switch preview request and no automatic focus theft. Fix1 checks: backend26/26, UI22/22, browser20passed plus2 desktop skips for mobile-only cases. Generated types, required type checks and normal hooks passed; final backend lint retains285 warnings/0errors. Scoped re-review closed both Important findings and mobile evidence with no new Critical/Important. Controller verified report/logs/commit scope;154 protected original-source fingerprints remain unchanged.

Public URL comparison, actual HTTPS image pixels, final registry/OCI identities, complete platform lock, human10-minute UAT and production operations remain downstream gates. Arbitrary widget media/reference/number/boolean bespoke visuals and ordinary control:text CTA route-membership are explicit unaccepted boundaries for final requirements review; the supported rich/text renderer is not a full arbitrary-widget visual claim. M1 lint warnings remain deferred Minor. No external publication, push or production changes occurred.

## B2 — Local immutable publication and installation accepted

Templates implementation range `6a2fd46a2c8d4bca93365bac4cffed831b0eb7c1..9d3687fd66f6efbe1945f19b685632116c725af1`; Preview range `f031349ad3a9b8632e7e180280039f4d14d7536b..91683c592961cbf3ebf341987a35106cf8c8449e`. Import-safe registry publication validates immutable source/manifest/bundle identities and publishes the combined indexes in one Git commit. Installation verifies bounded archives and every file before directory installation and registry visibility. The two filesystem renames are a recoverable two-phase operation; a verified unregistered orphan can be safely recovered. Original approved schema1 bundles retain exact-identity read compatibility, while new installations require provenance.

Actual browser execution required preview-only Nuxt metadata/payload suppression and exact registered-base navigation normalization. Public configuration and strict Preview CSP remain unchanged. Independent review found an incompatible legacy workflow gate and nondeterministic rebuilds on publication retry. Fix1 selects the exact declared runtime contract and resolves approved artifacts before building. Tests against local Git/OCI fixtures prove recovery after registry commit plus downstream failure, without rebuilding or changing the approved image/preview pair. Scoped independent re-review closed both Important findings, with no new findings.

Final fix evidence: selected public runtime gate1/1 per template, also with the other storefront build absent; retry7/7; Templates root66passed/1explicit legacy skip. Initial separate scopes were storefront24/24 each and Preview23/23. Refreshed current-source artifacts bind both 15-file bundles to Templates9d3687f; actual ORAS exact-digest reads are byte-identical, safe installation is idempotent, all30 files and both roots serve200, and both browsers handshake/navigate without page/console/fetch errors. Production retry preparation also reuses each actual built artifact with pulls1/builds0/pushes0. Historical32606c4 artifacts remain separately identified. Controller inspected report/proof/log evidence and final commits;154 protected source fingerprints remain unchanged.

These are local artifacts and an isolated HTTPS browser route fixture. Local OCI manifest hashes, compressed archive hashes and bundle digests remain distinct. No external publication, public-host comparison, production HTTPS image-pixel acceptance, real common-source release attestation, complete PlatformLock or production switch is claimed. B2 overall remains pending those external gates.

## B3 — Deployment and browser integration accepted locally

CMS `acd4125e011107b6558c5148e67d0964708e5cc4` and reviewed fix `967f88bde8609cd178ee7d452ad67f1546863a97`; Preview `d54a9cedc5f3af9a76fa11b506d17823dad4756f`. Exact optional Preview origin now reaches both CMS proxy deployment paths. Preview Compose mounts approved bundles/registry read-only; the TLS edge preserves resolver identity, CSP and cache headers. Distinct local bundles compile the actual fixture origin and pass the production builder/extractor/installer, without relabeling approved B2 artifacts.

Each template's desktop/mobile scope has14 passed matrix cells and2 blocked PUBLISH cells; the runner additionally passes6 fixture checks per template. Actual uploaded HTTPS images decode to verified pixels, rich content survives save/reload, unsaved drafts appear within one second and remain excluded from saved-runtime content. This runtime comparison is explicitly isolated and does not prove Gateway publication. Three post-matrix source changes have separately retained focused evidence; historical matrix identities remain unchanged. Focused media checks passed2/2 per template and formal-field fallback2/2. Actual stock-nginx checks passed3/3, isolated TLS edge1/1, ORAS readbacks4/4, safe browser checks7/7 and final controlled canary1/1. Scoped default unit runs retain17 CMS environment skips and1 Preview edge skip; they are not counted as passes.

Failure diagnostics use a fixed-schema interaction timeline and masked screenshots, with native trace/HAR/video disabled. Credential canaries across request, storage, DOM and console channels are absent from retained text;40,000 pixels in the injected private rectangle match the mask color. Public/full-lock acceptance remains distinct and nonzero when required inputs or cells are absent.

Independent review found that formal PUBLISH's GET status/history calls could resume a pending release. Fix1 adds a selected-site operations.read observation endpoint using only repository reads and an explicit Gateway GET. Pending intent blocks before Gateway access; ready state binds authoritative release/revision to the owned immutable payload/template and checksum. The shared verifier checks exact expected identity and marker; setup guards fail on any recovery/mutating request. Real authenticated setup+verifier+Mongo+Gateway integration passed1/1 with zero pending Gateway calls or Mongo writes. Backend34/34, verifier/gate7/7, types and normal hooks passed;285 baseline lint warnings remain. Scoped re-review closed the Important finding with no new blocking issue.

Deferred Minor findings: inherited color-variable log warnings, and guard-triggered authenticated failure currently exits before safe diagnostic attachments are finalized. The latter does not permit publication or a passing result, but reduces diagnostics and remains for final whole-branch review. C2 must migrate the new observation configuration consumer to its async binding resolver.

Controller inspected review/report, source binding, matrix/media and cleanup proofs;154 protected source fingerprints remain unchanged. Owned processes/ports/databases/private files were cleaned and shared databases stayed healthy. Formal PUBLISH, genuine public artifact identities, full PlatformLock, authoritative public DNS/TLS, D1 composition, human UAT and production switch remain unrun/pending. Overall B3 is not checked complete.

## Next task

C1 Gateway idempotent provisioning and source identity authorization, followed by C2–C4. A4 final public-chain acceptance remains dependent on authentic external artifacts. D1 retains settings/translation regressions and defines mandatory cases before F1 finalization.

## C1 — Idempotent provisioning and management identity accepted

Gateway `815b1e397464011262b4c86d63578bd090f3020b` adds transactional source workspace/site bindings, server-generated pending default domains, and source-scoped authorization across all eleven management resources. Dynamic requests use the trusted backend instance and both source headers; partial or foreign identities never fall back. Legacy mode requires both headers absent and actual site ownership.

Eight-way concurrent provisioning and cross-source key races run against real PostgreSQL. Original source/key replays the same identity; key/tuple mismatch returns 409 without mutations or orphan mappings. The exact reserved default Domain is persisted with a same-site foreign key and deletion restriction, preserving its URL across primary/config changes. C3 must keep the original requestKey for every retry; C4 must preserve this default identity. These additive decisions avoid silently changing identity on retry; clients must retain the original key and explicit future destruction must account for the reserved-domain reference.

Final C1 SQL/actual-handler suite: 15 passed, zero skips. Full repository: 243 passed, zero failures, one existing Linux/root-only artifact case skipped on macOS. Build, typecheck and Prisma schema validation passed. Random task databases were removed. Independent spec/quality review approved with no Critical, Important or Minor findings. Actual CMS transport, onboarding, DNS/TLS and broader version/runtime acceptance remain C2/C3/C4/D tasks; provisioning alone does not mean online.
