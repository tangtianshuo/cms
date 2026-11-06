# Platform delivery execution record

Execution date: 2026-11-06 (Asia/Shanghai).

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

## Next task

B5 consolidates routes and content editing, followed by B6 → B7. Final B2 artifacts must include the amended Templates source; full B3, B4 public comparison and formal A4 acceptance retain those dependencies.
