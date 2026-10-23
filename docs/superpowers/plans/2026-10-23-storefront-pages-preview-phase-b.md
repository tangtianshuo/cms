# Storefront Pages and Preview Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator configure imported page drafts and preview unsaved Entry changes in the installed theme without publishing drafts.

**Architecture:** Keep the one-site phase A installation as the page-draft owner. Page definitions gain validated SEO, sections, and optional fixed Entry bindings. An authenticated preview service resolves fields through imported model/Prop IDs into a versioned visual payload; the existing Nuxt preview iframe renders it with the same preset component used for catalog demos. Public draft paths remain 404; release-backed public routing belongs to phase C.

**Tech Stack:** TypeScript, Fastify 4, MongoDB, Vue 3, Nuxt 4, Node test runner.

**Spec:** `docs/architecture/storefront-preset-solution.md`, phase B.

## Global Constraints

- Preserve the phase A import format and existing installed sites; new page fields must have defaults.
- Preserve the legacy product route and preview for CMS instances without an installed preset.
- Preview requires CMS authentication and template permissions; the browser receives no CMS secret.
- Preview uses the editor's unsaved Entry data, supports the selected language, and never writes it.
- Imported page definitions stay drafts. No public page or product route may expose a preset demo Entry.
- Section and field bindings are allowlisted by the installed preset version.

---

### Task 1: Page draft configuration

**Files:** `backend/src/presets/site-model.ts`, `backend/src/presets/pages.ts`, `backend/src/presets/pages.test.ts`, `backend/src/presets/controller.ts`, `backend/src/presets/import.ts`, `backend/src/presets/catalog.ts`.

**Interfaces:** `pageDraft(site, key)` normalizes old and new page records. `updatePageDraft(site, key, input)` validates title, SEO, section selection, a fixed Entry binding, and path collisions, returning an updated installation. Existing dynamic `:slug` blueprints remain patterns. `POST /api/v4/presets/pages/:pageKey` is ADMIN-only.

- [x] Write tests for migration defaults, valid updates, unsupported sections, invalid Entry/template bindings, and route collision rejection; run to observe failures.
- [x] Implement the model, pure validation, import defaults, repository-backed controller method, and focused tests.
- [x] Run backend type check and existing preset tests.

### Task 2: Authenticated universal preview

**Files:** `backend/src/storefront/preset-preview.ts`, `backend/src/storefront/preset-preview.test.ts`, `backend/src/storefront/controller.ts`.

**Interfaces:** `previewPresetPage({site,pageKey,entry,language,...})` checks site/template/page identity and maps actual Entry fields and media into `{kind:'preset-page',preset,view,sections,seo}`. `POST /api/v4/storefront/page-preview` requires USER JWT plus template read permission and responds with `no-store` and `noindex`.

- [x] Write failing tests for home, collection, product, and content-page mappings; include unsaved values, media, wrong-template, invalid language, and unrelated field IDs.
- [x] Implement mapping and controller authorization without changing saved Entry data.
- [x] Run all backend tests and type check.

### Task 3: Shared storefront rendering and draft-safe routing

**Files:** `storefront/app/components/PresetDemoPage.vue`, `storefront/app/pages/preview.vue`, `storefront/app/types/preset.ts`, `storefront/app/utils/preview.mjs`, `storefront/test/page-preview.test.mjs`.

**Interfaces:** The preset component accepts both catalog demo and authenticated draft payloads, with section visibility and disabled draft navigation. Imported draft paths have no public route until a Release exists. Preview never fetches an editor's unsaved data through a public GET.

- [x] Write failing tests for invalid preview payloads and check that draft paths remain 404.
- [x] Implement the shared renderer and preview message handling.
- [x] Run storefront tests, type check, build, and inspect the responsive preset rendering.

### Task 4: Page editor and Entry preview button

**Files:** `ui/src/views/dashboard/presets.tsx`, `ui/src/views/dashboard/entry.tsx`, `ui/src/components/storefront/page-draft-editor.tsx`, `ui/src/components/storefront/page-preview.tsx`, `ui/src/components/storefront/preview-state.ts`, `ui/src/util/page-preview.ts`, `ui/src/i18n/locales/en.ts`, `ui/src/i18n/locales/zh-CN.ts`, `ui/test/page-preview.test.mjs`.

**Interfaces:** The preset screen edits page draft title, SEO, section visibility, and fixed Entry binding. Imported Entry editors expose a Preview Page command; the drawer selects a valid page and desktop/mobile width, reuses the existing request gate and postMessage origin check, and refreshes on unsaved changes. Legacy product preview stays available outside installed presets.

- [x] Write failing focused tests for page selection, stale preview response rejection, and request payload construction.
- [x] Implement the editor controls, preview drawer, loading/error states, and translations.
- [x] Regenerate backend declarations and run UI tests, type check, and build.

### Task 5: End-to-end verification

**Files:** `docs/architecture/storefront-preset-solution.md`, `storefront/README.md`.

- [x] Verify old and fresh site installations with isolated MongoDB; create Entries, preview unsaved text in each layout, and confirm drafts remain 404 publicly.
- [x] Run all backend, storefront, and UI tests; type checks/builds; `git diff --check`.
- [x] Document the delivered phase B boundary, commit on `codex/storefront-pages-preview-phase-b`, and leave Docker production untouched until requested.
