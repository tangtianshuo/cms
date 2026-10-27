# Public template roundtrip implementation plan

**Goal:** Publish AeroFrame 1.0.1 publicly and complete its import/edit/publish flow from CMS on the deployed validation server.
**Spec:** `../specs/2026-10-27-public-template-roundtrip-design.md`.
**Architecture:** Public immutable Git manifests plus GHCR images; CMS snapshots imported template metadata; Gateway binds/pulls verified immutable images and exposes operation status.
**Execution:** Tasks have nonoverlapping repositories and a frozen shared contract. Follow the existing Chinese subagent task ownership guidance; no agent commits, pushes, publishes or changes server state. Coordinator handles review and authorized remote publication/deployment after checks.

## Global constraints

- Preserve existing 1.0.0 and all user content; new template version is 1.0.1.
- Only fixed trusted GitHub source and exact GHCR repository are accepted; no arbitrary remote URL.
- Two digests use sha256-prefixed lowercase hex. Canonical JSON uses binary key comparison.
- Snapshot format stays v1; no generic arbitrary-code/template builder added.
- Existing local publication and local image compatibility remain available.
- Public source/images only; company drafts, credentials, deployment .env and private artifacts must never be committed.
- Narrow rollout: one existing configured Gateway site bound to one CMS site. Other CMS sites cannot publish into it.

## Task 1: Template release artifacts and CI

Own templates repository. Add presentation schema and version 1.0.1 from existing AeroFrame preset; add MIT license. Implement registry record generation/validation, immutable release merge and source paths. Add tests for invalid checksums, duplicate versions, conflicting publication, missing presentation and failed publication. Add tag-triggered GHCR workflow with test/build/smoke/provenance/anonymous-read gate and serialized registry branch publication. Document actual commands and initial package visibility requirement. Run npm test, npm run validate, new version validation, storefront tests/build, workflow syntax checks.

## Task 2: Gateway public pin, pull and status

Own Gateway repository. Add pin migration and fixed registry reader; implement PUT template-pin and GET operation by ID; add service auth/site-isolation tests. Extend Docker adapter for approved immutable GHCR pull and worker selection using database pin; preserve local-image validation. Validate pin and Release agreement at start and finalize. Run relevant unit/integration tests, typecheck/build. No production DNS work or generic registry support.

## Task 3: CMS verified import and publication UI

Own CMS backend/UI. Add trusted registry reader, manifest normalization and persisted imported snapshot; explicit same-id compatible adoption preserving drafts; change all preset lookup consumers to stored snapshot where present. Add API catalog/plan/import fields with backward compatibility and errors. Add site-bound Gateway publish intent, revision lookup and status proxy. UI shows version/source, explicit import/adopt, polling and visit link; no local rollback for Gateway state. Run focused tests, backend typecheck, UI build; cover wrong-site rejection, tamper, immutable adoption and retry identity.

## Task 4: Review, public release and deployed acceptance

Coordinator reviews task reports/diffs and fixes material issues before publication. Audit tracked template content/history for secrets/license issues. Commit/push only scoped reviewed public release work when authorization permits, then run CI and anonymously verify index/manifest/image. Build and deploy reviewed CMS/Gateway artifacts to the existing validation project with backup and migrations. Adopt published 1.0.1 into existing AeroFrame without losing edits, edit one demo title through CMS, publish through the new UI/API, restore the chosen final content, verify public rendering and repeat publication. Record skipped/not-run tests honestly; retain credential privacy and sub2api health.
