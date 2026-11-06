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

## Next task

Build the explicitly early B3 browser fixture foundation, then continue B4 → B5 → B6 → B7. Keep full B3 and formal A4 acceptance pending their real B2/B7 dependencies.
