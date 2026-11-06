# A4 local cross-repository runtime verification — 2026-11-06

Status: **local candidate evidence passed; A4 formal acceptance remains pending B2**. No external publication, push, merge or production change was performed. AeroFrame 1.0.4 and FireGuard 1.0.1 remain unpublished candidates. No old template version was edited.

## Exact runtime source combination

`build.mjs` uses `git archive HEAD` into a fresh context per repository. Dirty/untracked files and local installed dependencies cannot enter these contexts. Dockerfiles run their locked install/build steps. Preview has a real Docker build and its source tests run in the clean extracted context. This verifies clean-source buildability, not byte-identical rebuilding across mutable base images/package registries.

| Repository | Commit |
| --- | --- |
| cms | `0db4e29eae9b06f0c5479ce2fe8f7ecc577a4917` |
| gateway | `58e615f10cc42cbffb711de65130d9ab9879de7a` |
| templates | `ed63e4e814d028f1ca64af98b2a1da37138a649c` |
| preview | `f031349ad3a9b8632e7e180280039f4d14d7536b` |

The CMS value is the application source commit used by these images. The A4 harness was developed and run in this isolated CMS checkout; its subsequent tooling commit is recorded separately in the task report, avoiding a self-referential lock. The Gateway and Templates commits include the two minimal runtime defects discovered by this exercise.

| Local image | Docker Engine image ID |
| --- | --- |
| cms | `sha256:4338f56d3f1e4f8c40b7d92a8c79993c652e75a6d9c2279f11ea43b7b6f229af` |
| gateway | `sha256:d9ac17ab7e3be63960e79ea11d74c0373fa4b53fd3062cc8f30954b8e788e70e` |
| preview | `sha256:46686efc92f646bb0c14700d0c16a48e03a3c8692443cfe78076ea629c62be1b` |
| aeroframe-1.0.4 | `sha256:44b523fdabe8d71416feeb4a2e203c06264c4230dde6a8f7b5578b49d2354c1b` |
| fireguard-1.0.1 | `sha256:7db065ab43385c3bfa9b72c2178a947b9052d71fc1701e6e7d4113c649db2f0d` |

These are actual local Docker Engine image identities, **not published OCI registry manifest digests**. Each candidate's Docker `Config.Image`, inspected `Image` and authoritative `ActiveDeployment.imageDigest` were asserted equal. No `GATEWAY_LOCAL_IMAGE_DIGEST` substitution exists. No formal `docs/releases/platform-lock.json` is generated from these values.

## Topology and actual faults

Unique compose project: `platform-a4-29ed9dfc36`. CMS, control and ingest are separate Docker namespaces. CMS reaches control through a local HTTPS nginx sidecar and explicitly trusted disposable CA; the production URL validator is unchanged. A real request executed inside CMS verified TLS and received 401 without credentials. Public traffic and worker are separate production host Node processes; traffic forwards to loopback-published real Docker template containers. Domain readiness is an isolated database fixture, not a claim of real DNS/ACME provisioning.

| Runtime | Docker container | Active release | Route revision |
| --- | --- | --- | --- |
| aeroframe@1.0.4 | `5feaf5979ddbdc0793426d2005aa6d6d0bbfc93a3ce216fa0c69f89f2310b773` | `06543d81-d193-4662-bc83-3a48b52e532d` | 1 |
| fireguard@1.0.1 | `3c99526caafce3cdcb98b28332e902f3e90e5400ba5aa18e3b3829914f8e9e87` | `8b73fe24-2dfd-4deb-84ed-dd14f09de50a` | 1 |

Traffic PID: `45853`. Full service IDs, image IDs, sandbox IDs, worker PIDs, confirmed exit status and Docker `State.Running=false`/finish timestamps are preserved in the ignored `a4-runtime/runtime-isolation.json` evidence.

For every baseline and every fault, requests traverse the real independent traffic process. Paths: `/`, `/catalog`, `/product`, `/company`, `/_assets/media/proof/original.txt`, `/old-catalog`, `/sitemap.xml`. All status codes, body SHA-256 values and redirect destinations remain identical. The redirect returns 308 to `/catalog`; media bytes match the immutable fixture; sitemap is XML containing concrete public paths. Active release, image identity, revision and the complete route snapshot remain unchanged. When CMS, control or worker is stopped, independent Docker ingest still accepts a real event and its PostgreSQL row is verified.

| Fault case | Result | Confirmed stopped process/container |
| --- | --- | --- |
| aeroframe@1.0.4:cms-stopped | passed | `3042e2a9e045be950c869fcc010f2d224d02caf477d5e92e7cb346d72b26ceba` |
| aeroframe@1.0.4:gateway-control-stopped | passed | `62aeadccbd3043aaeb9b9222c9d651ef13975527e7ea3440b66e370843dfbe19` |
| aeroframe@1.0.4:worker-stopped | passed | `45868` |
| aeroframe@1.0.4:gateway-ingest-stopped | passed | `c065b8da3722a36a45c9e72053702a68f52182077275505fbd4bca18579f8979` |
| fireguard@1.0.1:cms-stopped | passed | `3042e2a9e045be950c869fcc010f2d224d02caf477d5e92e7cb346d72b26ceba` |
| fireguard@1.0.1:gateway-control-stopped | passed | `62aeadccbd3043aaeb9b9222c9d651ef13975527e7ea3440b66e370843dfbe19` |
| fireguard@1.0.1:worker-stopped | passed | `46086` |
| fireguard@1.0.1:gateway-ingest-stopped | passed | `c065b8da3722a36a45c9e72053702a68f52182077275505fbd4bca18579f8979` |

Artifacts are exact verified files at mode 0444 under a private 0700 directory, individually mounted read-only. Every runner owns its children, generated sites and candidate containers; `finally` restores stopped compose services, removes owned candidates/sites and closes all child processes. Final matrix cleanup recorded no remaining child PIDs, stopped services or errors. Shared/production resources are never selected by a global prune or generic name.

## Publication and integrity proof

Explicit `E2E_LOCAL_CANDIDATES=1` runs a separate local-image authority case: real control release API, explicit legacy approved local pin, actual worker and Docker adapter/engine. Both templates prove unpublished snapshot isolation, changed content after publication, rollback to original bytes, idempotency and stale-revision rejection. A new **unpublished candidate-only** artifact is corrupted; actual worker reports `CANDIDATE_START_FAILED`, the old pages/authority/route remain unchanged, and original candidate bytes/mode are restored in `finally`. This is an **artifact-integrity failure**, not an unhealthy-runtime claim. Worker restart keeps the independent traffic path available.

The actual CMS projection/Gateway/schema/renderer boundary is separately exercised for both versions by roundtrip and the 16-case Templates contract suite, including real CMS draft paths, release/media projection and built HTTP runtime. The local-image case does **not** claim full CMS public-registry publication.

## Reproduction and recorded results

Run from the isolated CMS checkout with these non-secret environment variables (credentials are generated into ignored mode-0600 `runtime.env` under a private directory):

```sh
export E2E_RUNTIME_DIR="$PWD/.superpowers/sdd/2026-11-06-platform-delivery-master/a4-runtime"
export E2E_GATEWAY_ROOT=/Users/445101599qq.com/.codex/worktrees/platform-delivery-gateway/Independent-Website-Gateway
export E2E_TEMPLATES_ROOT=/Users/445101599qq.com/.codex/worktrees/platform-delivery-templates/Independent-Website-Templates
export E2E_PREVIEW_ROOT=/Users/445101599qq.com/.codex/worktrees/platform-delivery-preview/Independent-Website-Preview
node --test ops/release/platform-lock.test.mjs ops/e2e/build-source.test.mjs ops/e2e/quality-gate.test.mjs
node ops/e2e/runtime.mjs init
node ops/e2e/build.mjs
node ops/e2e/runtime.mjs up
node ops/e2e/runtime.mjs migrate
E2E_LOCAL_CANDIDATES=1 node ops/e2e/bootstrap.mjs
node ops/e2e/test.mjs contract
node ops/e2e/test.mjs gateway
E2E_LOCAL_CANDIDATES=1 node ops/e2e/test.mjs publication-control-plane
E2E_LOCAL_CANDIDATES=1 node ops/e2e/test.mjs runtime-isolation
node ops/e2e/test.mjs analytics-isolation
E2E_LOCAL_CANDIDATES=1 node ops/e2e/test.mjs quality-gate
```

Retained runtime initialization validates the disposable certificate dates, key and host. If it is expired or missing, init exits with instructions to select a new unused `E2E_RUNTIME_DIR` and initialize/build/start there; it does not change global trust or overwrite retained credentials.

`runtime-isolation` and local publication each start/stop their own independent worker and traffic processes. To run them manually for a public-registry flow, `runtime.mjs worker` and `runtime.mjs traffic` are separate commands. Do not start competing copies for the owned local matrix. The harness uses fixed loopback ports, so they must be free; it never kills an unrelated port owner. `E2E_TEMPLATE_MATRIX=id@version,...` at init selects candidate versions; the two new versions are the default.

- Lock, clean source extraction and gate unit tests: **11 passed, 0 failed/skipped**.
- All five local deployment image builds from four exact source archives: exit 0. Build directory: `/Users/445101599qq.com/.codex/worktrees/platform-delivery-cms/cms/.superpowers/sdd/2026-11-06-platform-delivery-master/a4-runtime/build-1793961790086`. Preview source tests: 2 passed, 0 failed/skipped.
- CMS→Gateway→Templates roundtrip: both identities passed.
- Gateway final full suite: **228 passed, 0 failed, 1 skipped**. The existing Linux root-owned mount test is skipped on macOS and is not counted as passed. The actual Docker read-only mount and permission checks above did execute successfully.
- Templates actual cross-repository contract suite: **16 passed, 0 failed/skipped**. New sitemap helper cases: **2 passed**.
- Docker adapter→strict engine socket plus existing client/adapter hardening: **29 passed, 0 failed/skipped**.
- Real two-template Docker fault matrix: **8/8 stop scenarios passed**, plus TLS/baseline proof; cleanup empty.
- Real local publication, rollback and integrity failures: both templates passed; full details in `local-publication.json`.
- A3 standalone independent production-process `analytics-isolation`: passed, retaining its separate random DB and real stop proof.
- Local quality gate: passed with scope `local-candidates-only`, `formalLockAccepted=false`; stale/missing/incomplete fault evidence fails its gate.

## Required later boundary

The formal quality gate is explicitly blocked (`public_chain_unverified`, exit 1) until matching public-chain evidence and verified PlatformLock identities are implemented after B2. A shape-valid lock and successful local evidence cannot make the formal gate pass. The original formal publication commands remain available.

Without the explicit local mode, `node ops/e2e/test.mjs publication-control-plane` currently exits 1 and writes `public-registry-publication.json` with `status=blocked`. `node ops/release/platform-lock.mjs verify docs/releases/platform-lock.json` exits 1 because no complete real lock exists. Neither is a pass or a skipped success.

CMS/public control currently permit only the canonical GHCR template repository; worker pulls that approved exact repository/digest. B2 must provide actual published candidate image and preview artifact/bundle digests after remaining new-template edits. Then record four exact source identities, generate the complete PlatformLock, verify Git/registry authenticity separately from shape validation, and rerun the original full public CMS→control→worker publication tests for both template bindings. The formal recovery test has been corrected to keep traffic independent and inject candidate-only artifact corruption; its public-registry execution remains blocked until B2. No registry allowlist was broadened for local convenience.

## Minimal product defects closed by A4

1. New template runtimes had no sitemap route: real built HTTP returned 404 for both. New artifact-only sitemap routes reuse validated local snapshot loading, escape XML, accept only a valid canonical Host, exclude private/parameter blueprint paths, and fail closed for missing/corrupt artifacts. Built HTTP tests confirm zero control requests. Templates commit `ed63e4e814d028f1ca64af98b2a1da37138a649c`.
2. A3 adapter added trusted ingest Env but the strict Docker client still accepted only the old six/seven-item layout. Actual Docker publication failed before create with `Invalid Docker request`. The validator now accepts exactly the trusted origin and optional snapshot positions, preserving all field/prototype/allowlist restrictions and rejecting unknown, duplicate and injected Env. A real adapter→client→Unix-socket regression covers enabled/disabled ingest and optional artifact. Gateway commit `58e615f10cc42cbffb711de65130d9ab9879de7a`.

## A4 review fix1 — local evidence validation

Both local evidence consumers now bind recorded CMS/control/ingest/template image IDs to the exact `build.images` identities, including template configured/authoritative/active image fields. Missing or mismatched records fail validation. Publication evidence additionally requires all publication/rollback, idempotency/stale-revision, integrity-failure and restart scenarios and complete successful cleanup. The producer finalizes `passed` only after cleanup.

Focused review regressions: `node --test ops/e2e/runtime.test.mjs ops/e2e/quality-gate.test.mjs ops/e2e/build-source.test.mjs` — **10 passed, 0 failed/skipped**. The unchanged historical matrix/publication JSON both passed the stronger validators against the original build evidence. Clean-source extraction also passed from an empty OS temporary cwd without `.superpowers`. No Docker matrix or application build was repeated for these tooling fixes; the source/image identities above remain historical.
