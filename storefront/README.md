# Storefront phase one

This Nuxt storefront supports installed presets, immutable published Releases,
incremental pages and rollback. It serves one configured site, language and
host. The CMS previews unsaved changes in an iframe at `/preview`.

## Setup

1. Run the existing CMS database, backend, and UI so the CMS is reachable at
   `http://localhost:8080`. Configure these variables in `backend/.env`:

   ```dotenv
   STOREFRONT_ENABLED=true
   STOREFRONT_HOST=localhost:3000
   STOREFRONT_SITE_NAME=Example Store
   STOREFRONT_LANGUAGE=en
   STOREFRONT_CURRENCY=USD
   STOREFRONT_MEDIA_ORIGIN=http://localhost:8080
   ```

2. Configure `ui/.env` with `VITE_STOREFRONT_ORIGIN=http://localhost:3000`
   and restart the UI server. Configure `storefront/.env` from
   `storefront/.env.example` if the defaults differ.
3. Run `npm install --prefix storefront`, then `npm run dev --prefix storefront`.

With `STOREFRONT_ENABLED=true`, the backend creates the `product` content
Template on startup if absent. Its fields are `title` (product name), `slug`,
`price` (number), `description` (text), and `images` (media array). Create a
product Entry in the CMS, add its values for the configured language, and
open `http://localhost:3000/products/<slug>` if no preset is installed. An
installed preset requires a published Release. The product editor shows a live
preview before changes are saved.

## Phase A storefront presets

The CMS dashboard now has a **Storefront presets** page at `/d/presets`.
Administrators can compare the Atelier and Market presets, switch among home,
collection, product, and content-page demos, inspect generated model changes,
and import one preset. The import creates five CMS Templates (product,
collection, home, content page, and site settings), four draft page definitions,
and a setup checklist. Optional example Entries contain text and references;
the demo images belong to the preview and are not copied into CMS media.

Run the backend and UI as usual, then run the Nuxt storefront with
`NUXT_CMS_INTERNAL_ORIGIN` pointing to the backend. Set
`VITE_STOREFRONT_ORIGIN` in `ui/.env` to the Nuxt origin and rebuild or restart
the UI. Visit `/d/presets` on the backend origin. The same public demos are at
`/presets/atelier` and `/presets/market`; use the `view` query parameter with
`home`, `collection`, `product`, or `page`.

For an isolated backend test, `SERVER_PORT` overrides its default port 8080;
`DB_URL` and `STORAGE_SCOPE` can select a separate MongoDB database. Existing
CMS data does not need to be modified to preview a preset.

## Phase C publication

Imported pages remain drafts until an administrator uses **Check publication
differences** and **Publish release** in `/d/presets`. Each Release stores rendered
content, theme, navigation, SEO and routes independently of mutable Entries.
Saving content does not change the live site. Validation or activation failure
keeps the previous Release active. History supports rollback and records actors
and failures; rollback changes public content while retaining current drafts.

Use **Add page** to select an installed blueprint, bind a matching Entry and set
a path, SEO, sections and navigation. Publish to activate the new URL and sitemap
entry. Renaming a fixed page produces a 301 from its earlier path. Unchecking
**Include in next release** retires its URL on publication; navigation and internal
links must remain valid. An Entry may be shared by dynamic and fixed pages.

Public routes and `/sitemap.xml` read only the active snapshot. Installed sites
return 404 before first publication and disable the legacy direct product API.
HTML and publication queries use `Cache-Control: no-store`; external CDN caching
must respect this policy. Release media retain CMS URLs, so referenced files
must remain available and be included in operational backups.

## Behavior and limits

- The theme accepts schema version 1 and three platform sections: gallery,
  information, and description. Field bindings use Template prop IDs. Unknown
  sections and invalid bindings fail validation.
- Installed presets use Release publication. The legacy saved-product route is
  available only without an installation. Multiple sites/languages/domains, theme
  migration and CDN cache-purge adapters remain later phases.
- `/preview` has no draft data of its own. An authenticated CMS preview API
  maps the unsaved Entry; the editor posts that result to the iframe using the
  configured origin. The preview route has `noindex` and `no-store` headers.
- The CMS and storefront origins must be reachable by the browser. Image
  URLs use `STOREFRONT_MEDIA_ORIGIN`. The storefront's private
  `NUXT_CMS_INTERNAL_ORIGIN` is used only by the Nuxt server.

## Checks

Run `npm test --prefix storefront`, `npm run typecheck --prefix storefront`,
and `npm run build --prefix storefront`. Backend and UI checks are
`npm run build:noEmit --prefix backend` and `npm run type-check --prefix ui`.

Database/SSR coverage: `backend/src/presets/release-integration.test.ts`.
Deployment lifecycle coverage: `backend/test/storefront-deployment.test.mjs`,
using `STOREFRONT_E2E_CMS`, `STOREFRONT_E2E_ORIGIN`, `STOREFRONT_E2E_EMAIL` and
`STOREFRONT_E2E_PASSWORD`. Use a fresh disposable database with an English language
and test administrator. See `docs/verification/storefront-phase-c.md` for results.
