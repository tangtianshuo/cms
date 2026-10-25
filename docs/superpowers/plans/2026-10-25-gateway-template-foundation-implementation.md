# Gateway Template Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze current CMS publication contracts and establish independent platform-team template image publication (roadmap stages 0–1).

**Architecture:** CMS remains unchanged to users. A separate template repository validates declarative source manifests, builds reviewed Nuxt images, and publishes approved image digests and immutable manifests through an independent registry. Gateway, site deployment and CMS integration belong to stages 2–6, not this plan.

**Tech Stack:** Node 22, `node:test`, Zod (already present in CMS), JSON Schema/Ajv (new template repository), Nuxt 4, Docker/OCI, GitHub Actions and GHCR, organization-managed signing policy.

---

## Scope, prerequisites and file map

Execution requires an organization-owned private `storefront-templates` repository, private GHCR image publishing, CI OIDC permissions, an organization-controlled signing trust policy, a versioned artifact store with conditional index updates, and retention protection for all referenced image/artifact digests. These resources and credentials must be provisioned, not committed. `storefront-templates/` below denotes the separate repository, **not** a new directory in this CMS checkout. Confirm repository and registry identities before implementing CI. Do not delete current `storefront/`, alter production Compose, or commit without explicit authorization.

In this CMS repository:
- Create `backend/src/presets/legacy-contract.test.ts`: characterize existing preset/site/Release/domain identity using pure fixtures.
- Create `backend/src/presets/template-contract.ts` and `backend/src/presets/template-contract.test.ts`: validate a registry record and future site-scoped Release envelope at the external trust boundary, without changing existing controller behavior.

In separate `storefront-templates` repository:
- `package.json`, `package-lock.json`: Node test, validation and build commands.
- `schema/template.schema.json`, `scripts/validate.mjs`, `test/validate.test.mjs`: source-manifest format, referential/media/route validation.
- `templates/aeroframe/1.0.0/template.json`: declarative source manifest with existing AeroFrame CMS keys and sample data/asset references.
- `templates/aeroframe/1.0.0/Dockerfile`, `templates/aeroframe/1.0.0/storefront/`, `test/image.test.mjs`: standalone reviewed template image and tests.
- `scripts/publish.mjs`, `test/publish.test.mjs`, `.github/workflows/template-release.yml`: immutable artifact/index publication and CI.

**Contract v1:** Source manifest is `{schemaVersion:1,id,version,name,description,compatibility:{cmsSchema:1,releaseSchema:1},models:[{key,label,description,singleEntry,fields:[{key,label,type,required,array,referenceModel?}]}],pages:[{key,title,path,modelKey,layout}],assets:[{path,checksum,mimeType}]}`. Source manifest contains **no image digest**. CMS `PropType` numeric values are validated against the existing enum at the CMS boundary. IDs, model/field/page keys and page paths are stable and unique; external scripts, absolute asset URLs and code uploads are forbidden in manifests. Publication record is `{schemaVersion:1,id,version,manifestChecksum,imageDigest,status:'available'}` and index `{revision,records:[...]}`. `imageDigest` is `sha256:` plus 64 lower-case hex digits and identifies a signed OCI image; `manifestChecksum` is SHA-256 of canonical JSON (recursively sorted object keys, arrays in original order, UTF-8). Source manifest is stored under `templates/<id>/<version>/<manifestChecksum>/template.json`. Publication adds image digest only **after** build and signature verification. Site pinning is a later-stage task.

### Task 1: Characterize legacy CMS contracts (stage 0)

**Files:** Create `backend/src/presets/legacy-contract.test.ts`; read `backend/src/presets/catalog.ts`, `site-model.ts`, `releases.ts`, `backend/src/site-domains/model.ts`, `backend/src/storefront/published.ts`.

- [ ] **Step 1: Add characterization assertions.** Import `getPreset` and `buildRelease`, using the fixture pattern in `backend/src/presets/releases.test.ts`. Assert `getPreset('aeroframe','1.0.0')` retains the existing five model keys and existing page keys/paths, a legacy `SiteInstallation` has `presetId`, `presetVersion`, `currentReleaseId` without any image pin, `buildRelease` returns `schemaVersion:1`, `siteId`, concrete pages, and `SiteDomain` retains `siteId`, `hostname`, `ownershipStatus`, `connectionStatus`. Use `node:assert/strict` and `node:test`; no live MongoDB.
- [ ] **Step 2: Run** `node -r ts-node/register -r tsconfig-paths/register --test src/presets/legacy-contract.test.ts` from `backend/`; expected PASS (baseline characterization, not a new behavior). Run `npm run build:noEmit`; expected exit 0. If the fixture disagrees with actual model fields, correct the test, not runtime code.
- [ ] **Step 3: Record and commit** only this test after authorization, message `test: characterize legacy storefront publication contract`.

### Task 2: Define registry and snapshot boundary (stage 0)

**Files:** Create `backend/src/presets/template-contract.ts`, `backend/src/presets/template-contract.test.ts`; consult `backend/src/presets/releases.ts` and `backend/src/prop/models/main.ts`.

- [ ] **Step 1: Add failing tests** importing `parseTemplateArtifact` and `parseSnapshotEnvelope`. Valid artifact input is `{record,manifest}` with exactly the v1 shapes above and matching `id/version`, checksum and `available` status. Reject invalid digest/checksum, unsupported `cmsSchema`/`releaseSchema`, duplicate model/field/page keys/paths, reserved `/api` or `/preview`, unresolved model/pointer references, mismatch between record and manifest, and invalid numeric `PropType`. A valid envelope is `{schemaVersion:1,workspaceId,siteId,releaseId,checksum,snapshot}` with existing `ReleaseSnapshot`; reject mismatching `siteId`, missing workspace or schema version, or incorrect canonical snapshot checksum. Use fixtures with actual enum values.
- [ ] **Step 2: Run** `node -r ts-node/register -r tsconfig-paths/register --test src/presets/template-contract.test.ts` from `backend/`; expected FAIL to import `./template-contract`.
- [ ] **Step 3: Implement** the two exported Zod parsers and their inferred types. `parseTemplateArtifact(value: unknown)` verifies a published record against its source manifest and SHA-256; `parseSnapshotEnvelope(value: unknown)` verifies site/workspace, schema and checksum. Keep pure: do not fetch external artifacts or change current catalog/controller/release activation yet. Reuse one canonicalization rule from this plan in the independent publisher; include a shared canonical checksum fixture in both repos' tests to prevent drift.
- [ ] **Step 4: Run** the focused tests and `npm run build:noEmit` from `backend/`; expected PASS. Commit contract and tests after authorization, message `feat: define external template artifact contracts`.

### Task 3: Validate source manifests in separate repository (stage 1)

**Files:** Create `storefront-templates/package.json`, `package-lock.json`, `schema/template.schema.json`, `scripts/validate.mjs`, `test/validate.test.mjs`, `templates/aeroframe/1.0.0/template.json`; reference `cms/backend/src/presets/catalog.ts` and `catalog.test.ts`.

- [ ] **Step 1: Initialize** a separate Node 22 package with `"test":"node --test test/*.test.mjs"` and `"validate":"node scripts/validate.mjs templates/aeroframe/1.0.0/template.json"`, install/pin Ajv and format packages in its lockfile. Require all contract fields and forbid unknown fields in the JSON Schema.
- [ ] **Step 2: Add failing validator tests** importing `validateManifest(manifest,root)`: valid AeroFrame, duplicate model/field/page keys or paths, unknown page model/pointer model, reserved `/api` and `/preview`, missing asset, bad checksum, path traversal/symlink, incompatible CMS/Release schema and remote script URL. Use temporary asset directories. `npm test` should FAIL with missing validator.
- [ ] **Step 3: Implement** JSON Schema and pure validation. Resolve each declared asset under `root`, check bytes against its sha256 checksum and MIME/extension, enforce reference and route constraints, and reject executable content references. Add source manifest preserving existing AeroFrame model/page keys; use checked-in local asset fixtures rather than a remote image. Run `npm test && npm run validate`; expected PASS. Confirm key/path parity against `cms/backend/src/presets/catalog.test.ts`.
- [ ] **Step 4: Commit** manifest, schema, validator and tests in the independent repository after authorization.

### Task 4: Build standalone template image (stage 1)

**Files:** Create `storefront-templates/templates/aeroframe/1.0.0/Dockerfile`, `storefront/package.json`, `storefront/nuxt.config.ts`, `storefront/app/pages/index.vue`, `storefront/server/routes/healthz.get.ts`, `storefront/server/utils/published.ts`, `storefront/test/render.test.mjs`, `storefront-templates/test/image.test.mjs`; read `cms/storefront/app/components/AeroPresetPage.vue`, `PublishedPage.vue`, `cms/storefront/test/release.test.mjs`.

- [ ] **Step 1: Write failing image test** that builds/runs the image with only test gateway URL, site ID and site-scoped credential, probes `/healthz`, `/`, and one representative content route using a fixture `ReleaseSnapshot`. Assert AeroFrame-specific rendered content and an interactive control, and absence of CMS admin origin/credentials. Run `node --test test/image.test.mjs`; expected FAIL because Dockerfile/image is missing.
- [ ] **Step 2: Extract** the reviewed AeroFrame layout/interaction into a self-contained Nuxt application. Its server-side data client authenticates to a mockable site-scoped gateway endpoint and parses only published Release responses; keep CMS preview/admin code out. Implement health route and Dockerfile building only this template source from its own locked dependencies; run as non-root, expose port 3000. Do not make the template's runtime dependent on the CMS repo at build time.
- [ ] **Step 3: Run** `npm test`, `npm run validate`, `docker build -f templates/aeroframe/1.0.0/Dockerfile -t local/aeroframe:1.0.0 templates/aeroframe/1.0.0`, `node --test test/image.test.mjs`; expected PASS. Record SSR output and interaction check on desktop/mobile test viewports, compare content with legacy AeroFrame for the shared fixture. Commit tested standalone image source after authorization.

### Task 5: Publish immutable images and registry entries (stage 1)

**Files:** Create `storefront-templates/scripts/publish.mjs`, `test/publish.test.mjs`, `.github/workflows/template-release.yml`.

- [ ] **Step 1: Add failing publisher tests** using an in-memory artifact store. `publishTemplate({manifest,imageDigest,signature,expectedRevision},store)` must reject unapproved/unsigned digest, accept same `id@version` + checksum + digest idempotently, reject changed bytes/digest for same version, leave index unchanged if artifact upload/read-back fails, and reject a stale index revision. Assert shared canonical checksum fixture matches CMS Task 2; `npm test` should FAIL importing publisher.
- [ ] **Step 2: Implement** publisher and store adapter (`getIndex`, `putImmutableArtifact`, `readArtifact`, `compareAndSwapIndex`) with checksum verification and conditional single-revision update. Only publish `available` metadata after signed digest and immutable manifest read-back verify. If index update fails, leave unreferenced artifact inaccessible to catalog and retry safely; never overwrite a referenced version. Run `npm test && npm run validate`; expected PASS including concurrent-update failure tests.
- [ ] **Step 3: Add CI** for reviewed version tags/manual release approval: locked dependency install, unit/manifest tests, Nuxt build, private GHCR build/push, digest capture, dependency scan, image signature/provenance verification against configured CI identity, container smoke, artifact upload/read-back, then conditional index update. Use short-lived scoped credentials and a single-writer concurrency group; fail closed on signature, digest, scan or read-back failure. No credentials in source. Provide the real artifact-store adapter for the provisioned provider; its conditional-write behavior must match Task 5 tests.
- [ ] **Step 4: Verify in a non-production registry:** publish a candidate, independently fetch/check image digest, signature, checksum and index revision; repeat identical publication and confirm idempotence; attempt changed bytes with same version and confirm rejection. Promote one approved version only after passing. Commit the workflow/publisher/tests in the independent repo after authorization. Do not wire CMS catalog to the index before stages 2–4.

## Acceptance and remaining work

Stage 0: characterization/contract tests and backend typecheck pass, with old sites/routes unchanged. Stage 1: a reviewed template with new layout and interaction can be built and registered by immutable signed digest without redeploying CMS or existing Storefront; invalid or mutated versions cannot enter `available`. Registry credentials and deployment infrastructure are external prerequisites; local tests alone cannot establish this gate.

This plan does **not** implement user-facing template selection, per-site containers, published snapshot data plane, CMS publish UI or custom HTTPS domains. These remain roadmap stages 2–6 and require separate plans after verifying this contract. Do not describe stage 1 success as a complete independent-site launch.
