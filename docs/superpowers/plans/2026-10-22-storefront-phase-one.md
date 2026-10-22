# Storefront Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one CMS-backed product detail page in an independent Nuxt storefront, with a live preview of unsaved CMS entry edits.

**Architecture:** The existing Template/Entry models remain the product content store. A narrowly scoped Fastify storefront API validates a versioned page configuration and maps a product Entry to a public view model. Nuxt SSR and its preview route render that same view model with the same theme components. The CMS entry editor sends its unsaved state to an authenticated preview API, then posts only the normalized result to a restricted iframe.

**Tech Stack:** TypeScript, Fastify 4, MongoDB, Vue 3, Nuxt 4, Node.js built-in test runner, Vite.

**Spec:** `docs/architecture/storefront-platform.md` (phase one); user confirmed phase one as the current delivery scope on 2026-10-22.

## Global Constraints

- One development site, one language, one product detail page type.
- No cart, checkout, orders, inventory, releases, custom domains, or multi-site administration in this phase.
- Do not expose long-lived CMS credentials to the browser or storefront.
- Reject unsupported configuration schema versions, unknown sections, invalid field bindings, and cross-template preview requests.
- Preserve the user's untracked architecture and prototype files.

---

### Task 1: Product contract and mapping

**Files:**
- Create: `backend/src/storefront/model.ts` — page config and view model types and Zod validation.
- Create: `backend/src/storefront/product.ts` — Entry to product mapping and template checks.
- Test: `backend/src/storefront/product.test.ts`.

**Interfaces:**
- `parseProductPageConfig(input: unknown, template: Template): ProductPageConfig` validates section registry and field types.
- `mapProduct(entry: Entry, template: Template, media: Media[], language: string, config: ProductPageConfig): StorefrontProduct` resolves fields by stable `Prop.name` and values by `Prop.id`.
- `productEntrySlug(entry: Entry, language: string): string | null` resolves the CMS slug metadata.

- [x] Write tests with hand-built Template/Entry fixtures for valid mapping, unknown section, invalid field binding, missing required content, and language selection.
- [x] Run `node --test` through `ts-node` with the backend aliases and confirm the new tests fail for the missing implementation.
- [x] Implement the contract and mapper using Zod and existing CMS types; constrain media URLs to the public media route.
- [x] Run focused tests and `npm run build:noEmit --prefix backend`.

### Task 2: CMS API and development product model

**Files:**
- Create: `backend/src/storefront/controller.ts` — public saved product endpoint and authenticated preview endpoint.
- Create: `backend/src/storefront/setup.ts` — idempotent development product Template provisioning.
- Modify: `backend/src/main.ts` — controller registration and opt-in setup during startup.
- Modify: `backend/src/config.ts` — development storefront host, language, and origin settings.
- Test: `backend/src/storefront/controller.test.ts` and `backend/src/storefront/setup.test.ts`.

**Interfaces:**
- `GET /api/v4/storefront/products/:slug` returns `{site, config, product}` for the configured development site or 404.
- `POST /api/v4/storefront/preview` accepts `{entry, config?}` only with an ADMIN or USER JWT, checks the Entry's product Template, and returns `{site, config, product}` without saving.
- Both responses use `Cache-Control: no-store` in phase one; preview has `X-Robots-Tag: noindex`.
- `ensureProductTemplate()` creates the `product` Template only when `STOREFRONT_ENABLED=true` and it is absent.

- [x] Write failing tests for valid public lookup, missing slug, unauthorized preview, unsaved preview state, and idempotent template setup.
- [x] Run the focused tests and inspect the intended failures.
- [x] Implement the endpoints and setup; use existing repository, JWT guard, and controller conventions.
- [x] Run focused tests and backend type check.

### Task 3: Shared Nuxt theme rendering

**Files:**
- Create: `storefront/package.json`, `storefront/nuxt.config.ts`, `storefront/app.vue`.
- Create: `storefront/types/product.ts` — serialized API view model.
- Create: `storefront/components/theme/ProductPage.vue`, `storefront/components/theme/ProductGallery.vue`, `storefront/components/theme/ProductInformation.vue`, `storefront/components/theme/ProductDescription.vue`.
- Create: `storefront/pages/products/[slug].vue`, `storefront/pages/preview.vue`, `storefront/server/api/products/[slug].get.ts`.
- Create: `storefront/assets/main.css`.
- Test: `storefront/test/site.test.mjs` and `storefront/test/render.test.mjs`.

**Interfaces:**
- SSR product route calls the CMS API server-to-server and returns a real 404 for absent products or an unmatched development host.
- A fixed section registry maps `product-gallery`, `product-information`, and `product-description` to platform components; user data is rendered as text, never executable code or raw HTML.
- The preview page accepts `postMessage` only from the configured CMS origin and renders the identical `ProductPage` component with `noindex`.

- [x] Write failing tests for host filtering, 404 mapping, and rendered product content/SEO metadata.
- [x] Run the focused tests and confirm failures are due to missing behavior.
- [x] Implement the Nuxt app and theme; install dependencies with a lockfile.
- [x] Run focused tests, `npm run typecheck --prefix storefront`, and `npm run build --prefix storefront`.

### Task 4: CMS editor live preview

**Files:**
- Create: `ui/src/components/storefront/product-preview.tsx` — preview panel, request debounce, iframe channel, error state.
- Modify: `ui/src/views/dashboard/entry.tsx` — show preview for the `product` Template and pass the reactive unsaved Entry.
- Modify: `ui/src/i18n/locales/en.ts`, `ui/src/i18n/locales/zh-CN.ts` — control labels and errors.
- Create: `ui/.env.example` — storefront origin configuration.
- Test: `ui/src/components/storefront/product-preview.test.ts` for message origin and stale response handling.

**Interfaces:**
- The editor calls `sdk.send({url:'/api/v4/storefront/preview', method:'POST', data:{entry}})` after local edits, never requiring an Entry save.
- The iframe receives `{type:'storefront:preview', payload}` with `targetOrigin` set to `VITE_STOREFRONT_ORIGIN`.
- Requests are debounced and old responses cannot overwrite newer edits.

- [x] Write and run failing tests for the preview message helper and stale result protection.
- [x] Implement the component and editor integration.
- [x] Run focused tests and `npm run type-check --prefix ui`.

### Task 5: Local run and end-to-end verification

**Files:**
- Modify: `docker-compose.yml` and `proxy/nginx.conf` if their existing routes require a storefront service path; otherwise document direct port 3000.
- Create: `storefront/README.md` and `storefront/.env.example` — exact setup, model fields, URLs, and phase-one limitations.

- [x] Run backend and UI type checks, storefront tests and build.
- [x] Start Nuxt on an unused local port; verify the product route, preview `noindex`, missing-product 404, and responsive product view with browser screenshots where possible.
- [x] Inspect `git diff --check` and `git status --short`; report any environmental verification gaps accurately.
