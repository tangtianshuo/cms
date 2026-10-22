# Storefront phase one

This is the Nuxt product detail storefront for the first delivery phase of
`docs/architecture/storefront-platform.md`. It serves one development site,
one language, and `/products/:slug` pages from saved CMS Entries. The CMS
product editor previews unsaved changes in an iframe at `/preview`.

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
open `http://localhost:3000/products/<slug>`. The product editor shows a live
preview before changes are saved.

## Behavior and limits

- The theme accepts schema version 1 and three platform sections: gallery,
  information, and description. Field bindings use Template prop IDs. Unknown
  sections and invalid bindings fail validation.
- Saved Entries are public immediately in phase one. Release snapshots,
  publish controls, rollback, theme selection, multiple languages/sites, and
  custom domains belong to later phases.
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
