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

## Next task

A3 implements independent lead/event HTTP intake, preserves management reads/writes in control, points both new templates to ingest, and proves separation using actual running processes and disposable databases.
