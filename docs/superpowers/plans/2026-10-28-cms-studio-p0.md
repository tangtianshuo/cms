# CMS Studio P0 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent tasks; keep reviews and integration sequential. Track completed tasks here and in the execution ledger.

**Goal:** Turn the approved single-site display/inquiry workflow into real CMS editing and reliable Gateway publication, retaining existing data and immutable template versions.

**Architecture:** CMS owns business editing, immutable source snapshots, actors and publication projections. Gateway owns the authoritative active deployment and performs deployment operations. A new template version consumes explicit page types and theme settings; older versions remain immutable. Studio uses authenticated CMS SDK calls, never demo localStorage as authoritative data.

**Tech Stack:** Existing TypeScript/Fastify/MongoDB, Vue/TSX, Next.js/PostgreSQL worker, Nuxt. No new runtime dependency required.

**Spec:** /Users/445101599qq.com/Projects/cms/docs/architecture/2026-10-28-prototype-three-stack-gap-analysis.md (approved by user).

## Global Constraints

- P0 implements one existing configured Gateway site; self-service multi-site provisioning, billing and commerce belong to subsequent phases.
- Preserve all existing user edits and immutable published template directories. Do not deploy, publish registry entries, push or alter production credentials.
- Backup created at /Users/445101599qq.com/Projects/cms-backups/20261028-092626; all repositories use codex/cms-studio-p0 branches.
- Work in the existing checkouts to preserve the running prototype and uncommitted sources; archived snapshots and feature branches provide recovery. No worktree relocation is necessary for this execution.
- Use test-first development for behavior changes; run narrow tests, builds/type checks and integration tests where services are available. Report unavailable environment checks accurately.

## Task 1: Versioned template compatibility and preview

Owner: templates implementer. Files: new templates/aeroframe/1.0.3/** plus validation configuration/tests as needed, and a reusable CMS preview integration if feasible without touching existing modified preview files.

- [x] Add regression tests showing explicit collection view works at /catalog and theme reaches rendered data.
- [x] Create 1.0.3 from 1.0.2 without changing 1.0.0–1.0.2. Stop inferring view from paths, validate allowed views explicitly, consume theme safely, preserve supported section order in renderer.
- [x] Expose a private iframe preview entry in the same renderer; validate message origin/source using configured admin origin, noindex/no-store, do not expose Gateway credentials. Preview payload is the CMS ReleaseSnapshot (CMS IDs are allowed only in private preview), optionally wrapped as {kind:'preset-site',...snapshot}. Share normalization/rendering code with published mode.
- [x] Build/test the new template and document adoption and capability limits. Publishing the new image is a separate release action.

## Task 2: Authoritative Gateway publication state

Owner: Gateway implementer. Files: apps/control/src/publication-state.ts, corresponding test and GET route at /api/v1/sites/[siteId]/publication-state.

- [x] Test unauthenticated and foreign-workspace rejection, empty active state, correct active tuple, malformed/tampered snapshot handling.
- [x] Return authenticated service JSON: {revision:number, active:null|{releaseId:string,imageDigest:string,routeRevision:number,metadata:object,snapshot:object,createdAt:string}}. revision is desiredRevision; snapshot is the validated immutable active Release bytes. Verify checksum and both workspace/site IDs; enforce existing 10MB limit, no-store. Do not include credentials or snapshotRef.
- [x] Keep existing API compatible. Run control tests/type checks and database integration if available.

## Task 3: Durable CMS Gateway publication lifecycle

Owner: primary implementer. Files: backend/src/presets/{gateway-publish,release-controller,release-repo,releases,site-model,site-repo}.ts plus focused gateway release helpers/tests, backend media access/retention tests.

- [x] Persist original CMS-identity frozen Release before network submission, preserving actor, template identity, previous live baseline and idempotent request metadata. Publication pinning protects media before submit; only confirmed successful releases grant anonymous access.
- [x] Add separate Gateway active projection fields; never point local currentReleaseId at a foreign runtime record. Reconcile against Task 2 state on reads/publish and periodic server reconciliation. Use monotonic routeRevision guards and reject stale browser baselines.
- [x] Support legacy intent recovery, durable history and audit, candidate failure without exposing draft images, restored historical snapshot/template identity as a new deployment attempt.
- [x] Return snapshotHash from preflight and reject changed content at publish when supplied. Add structured issueDetails alongside legacy issues.
- [x] Expose Gateway history/diff/rollback in real release manager. Preserve stable idempotency behavior on lost responses.
- [x] Run meaningful lifecycle regression tests, backend type check and relevant integration tests.

## Task 4: Real Studio business workflow

Owner: Studio implementer. Files owned: new backend/src/studio/**, registration file (coordinate with primary), new ui/src/views/dashboard/studio.tsx and owned components/styles, routing/nav integration. Existing prototype and modified preview/product-preview files remain untouched.

- [x] Build an authenticated business facade over installed template mappings, Entry, PageDraft and Media; enforce existing workspace roles and preserve fields outside simplified forms, including existing rich text.
- [x] Add SaaS Studio entry for overview, products/pages, media selection and settings, with visible save failures, unsaved guard, honest loading/empty/unsupported states. Use existing UI/UX Pro Max design system. No demo seed in real mode and no secret inputs.
- [x] Reuse real release and preview components. Unsupported runtime/template preview is explicit; no promise of same-version preview before a supporting template is adopted.
- [x] Test business mapping, route creation/conflict and authorization-sensitive operations; type-check/build UI.

## Task 5: Integration and review

- [x] Review cross-task boundaries (new template is not automatically adopted; Gateway state shape; CMS route registration; Studio roles; publication UI contract).
- [x] Run backend/UI/template/Gateway relevant checks, inspect UI in browser if runtime is available, repair findings and record evidence.
- [x] Deliver changes and a verification record with remaining deployment prerequisites. P1/P2 roadmap remains tracked explicitly and is not represented as completed.

## Completion evidence

2026-10-28: 本地实现、独立审查与修复、真实 Mongo/HTTP 集成及浏览器操作验收完成。后端138通过，UI29通过/1条件跳过，Gateway68通过/27数据库条件跳过，Templates29+15单测及1运行时集成通过；后端/UI/Gateway/Template构建和类型检查通过。尚未执行生产部署、镜像/注册表发布、模板采用，以及依赖PostgreSQL/Docker/部署CSP的验收，明确作为上线前条件。详见 docs/verification/2026-10-28-cms-studio-p0.md。
