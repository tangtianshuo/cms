# Storefront Presets Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator compare preset storefronts, import one complete starter site, and use a checklist to create content through generated CMS Templates.

**Architecture:** Platform-owned, versioned preset manifests define theme tokens, page blueprints, and content models. A persisted site installation records the selected preset, generated Template IDs, import progress, and draft pages. Authenticated APIs expose the catalog, import preview, idempotent import, and checklist. The UI previews demo pages using the storefront renderer and links directly to generated Entry editors.

**Tech Stack:** TypeScript, Fastify 4, MongoDB, Vue 3, Nuxt 4, Node test runner.

**Spec:** `docs/architecture/storefront-preset-solution.md`, phase A only.

## Global Constraints

- One installed site per CMS instance in phase A; multi-site/domain routing is phase D.
- Imported pages are drafts. This phase does not expose them on the public storefront or add Release semantics.
- Preset preview data is separate from site data. Optional demo content may be imported only when explicitly selected.
- Preserve existing product preview and existing Template/Entry flows.
- Unknown preset versions, incompatible existing Templates, and conflicting imports fail visibly.

---

### Task 1: Preset contracts and catalog

**Files:** Create `backend/src/presets/catalog.ts`, `backend/src/presets/catalog.test.ts`.

**Interfaces:** `listPresets()` returns safe catalog metadata. `getPreset(id, version?)` returns one immutable manifest with `models`, `pages`, `theme`, and preview content. Each model defines stable field keys and CMS Prop types; `title` and `slug` occupy the first two fields.

- [x] Write a failing test asserting that each preset has unique IDs/page paths, complete product/collection/home/content/site settings models, compatible field bindings, and two visual variants.
- [x] Run `node --test -r ts-node/register -r tsconfig-paths/register src/presets/catalog.test.ts` from `backend`; confirm a missing catalog failure.
- [x] Implement the typed catalog and validation, including sample preview text and media references.
- [x] Re-run focused tests and `npm run build:noEmit --prefix backend`.

### Task 2: Recoverable import and generated CMS attributes

**Files:** Create `backend/src/presets/site-model.ts`, `backend/src/presets/site-repo.ts`, `backend/src/presets/import.ts`, `backend/src/presets/import.test.ts`; modify `backend/src/repo.ts`, `backend/src/main.ts`.

**Interfaces:** `planImport(preset, existingTemplates)` returns creates/reuses/conflicts. `importPreset(input, source)` creates one site installation, required Templates/Props, page drafts, and optional example Entries. Source methods wrap existing repos to keep tests independent of MongoDB. Import can resume a failed site of the same preset; a completed import returns the existing site without duplicates.

- [x] Write failing tests for exact model fields, safe reuse of the current `product` Template, collision refusal, repeat import, and failure followed by retry.
- [x] Run the focused test and confirm feature failures.
- [x] Implement site persistence with a unique default slot, stable model-key/field-key mappings, and recorded import state. Add repo initialization to the backend.
- [x] Re-run focused tests and backend type check.

### Task 3: Authenticated preset API and checklist

**Files:** Create `backend/src/presets/controller.ts`, `backend/src/presets/controller.test.ts`, `backend/src/presets/checklist.ts`; modify `backend/src/main.ts`.

**Interfaces:** Public `GET /api/v4/presets/catalog` and `/catalog/:presetId`; ADMIN JWT required for `GET /plan/:presetId`, `GET /site`, and `POST /import`. The site response includes model IDs, draft pages, import status, and checklist steps with Entry counts and editor URLs.

- [x] Write failing tests for unauthorized access, a valid plan, a repeated import, and checklist links/counts.
- [x] Run the focused test and confirm feature failures.
- [x] Implement the controller using existing route protection and explicit input validation. Keep preset preview data public only through the separate storefront demo route.
- [x] Re-run focused tests and backend type check.

### Task 4: Whole-site demo preview

**Files:** Create `storefront/app/pages/presets/[id].vue`, demo components/styles and `storefront/test/preset.test.mjs` as needed; update `storefront/nuxt.config.ts` only if required.

**Interfaces:** `/presets/:id?view=home|collection|product|page` renders actual sample layout with a consistent header/footer, theme colors, and representative images on desktop and mobile. Atelier and Market are the two visual variants. Invalid IDs or page types return 404. The route is noindexed.

- [x] Write a failing focused test for preset lookup, page selection, and unknown IDs.
- [x] Run `npm test --prefix storefront` and confirm the new failure.
- [x] Implement the demo renderer and responsive views from the catalog contract or a versioned storefront-side demo bundle.
- [x] Re-run storefront tests, typecheck, and build; inspect rendered desktop/mobile views.

### Task 5: Admin catalog, import, and setup checklist

**Files:** Create `ui/src/views/dashboard/presets.tsx`, UI helpers/tests as needed; modify `ui/src/router.ts`, `ui/src/views/index.ts`, `ui/src/layouts/dashboard/aside-content.tsx`, `ui/src/i18n/locales/en.ts`, `ui/src/i18n/locales/zh-CN.ts`.

**Interfaces:** `/d/presets` shows available presets and demo previews with page/viewport controls. An admin can inspect the import plan, select empty/demo data, name the site, import, and see a checklist whose actions open the generated Template/Entry editors. Import status and errors are visible.

- [x] Test checklist navigation, generated Entry creation, import conflict and retry logic; verify focused failures before fixes.
- [x] Implement the view and navigation using existing dashboard components and `sdk.send`.
- [x] Generate backend declarations (`npx tsc -p backend/tsconfig.json --emitDeclarationOnly --outDir backend/types --rootDir backend/src`) and run UI type check/build.
- [x] Manually verify gallery and checklist at desktop/mobile widths; verify import and Entry creation against an isolated MongoDB.

### Task 6: Final integration

**Files:** Update `storefront/README.md` and `docs/architecture/storefront-preset-solution.md` only where implementation status needs precision.

- [x] Run all focused and existing backend/storefront tests, backend and UI type checks, and storefront/UI builds.
- [x] Inspect `git diff --check`, status, and generated files; retain only intended source/docs changes.
- [x] Commit the completed phase A work on `codex/storefront-presets-phase-a`.
