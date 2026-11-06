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
| All-target contract roundtrip | Pending A2 | Clean Templates target does not yet contain contract schema |

The initial DB-free test invocation skipped 38 database tests. Those skips were not treated as passes; the real SQL runner subsequently exercised them. The 195 and 123 counts describe different revision/test scopes and are not added together as unique cases.

A1 does not prove complete template outage behavior, real preview delivery, automatic provisioning, full version locking, production acceptance or human 10-minute usability. These remain the later plan tasks.

## Next task

A2 is integrating immutable AeroFrame 1.0.4 and FireGuard 1.0.1 from both preserved source lines. The remote registry was checked and neither planned version was occupied. Published older directories must remain unchanged; actual artifact publication and final digests are later gates.
