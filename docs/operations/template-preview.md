# Versioned template preview configuration

The Studio button opens `/d/presets/site-preview`, which fetches the authenticated CMS site snapshot and selects a renderer from its template identity. Saving drafts, adopting templates and publishing remain separate operations.

## Selection

- `aeroframe@1.0.3`: requires an explicitly configured `VITE_TEMPLATE_PREVIEW_ORIGIN`, pointing to the origin of a renderer built from that exact version. The UI verifies the renderer's version handshake before posting private drafts.
- `aeroframe@1.0.1`, `aeroframe@1.0.2`, other identities/versions, and mixed-version snapshots: show an honest unsupported/upgrade message; the UI does not send them to another renderer.
- Built-in `atelier`, `market` and `aeroframe` version `1.0.0`: retain `VITE_STOREFRONT_ORIGIN` (default `http://localhost:3000`) for the existing CMS display preview. The UI labels this as content checking, whose appearance may differ from the independently published website. This is not a same-version compatibility promise for a public 1.0.0 image.

## Configuration prerequisites

In the CMS UI build environment:

```dotenv
# Existing built-in CMS display preview origin
VITE_STOREFRONT_ORIGIN=http://localhost:3000
# Separately run, exactly matching AeroFrame 1.0.3 renderer; blank disables it
VITE_TEMPLATE_PREVIEW_ORIGIN=https://template-preview.example.com
```

Origins must be exact `http://host:port` or `https://host` values without paths or trailing slash. These are public build-time settings, never credentials. Changing them requires rebuilding the CMS UI. The committed example leaves external preview disabled; no local or production environment is changed automatically.

The CMS release workflow passes the GitHub `production` environment variables `VITE_STOREFRONT_ORIGIN` and `VITE_TEMPLATE_PREVIEW_ORIGIN` to the Docker build. Set them before releasing a CMS image that needs these previews; an empty external origin intentionally leaves same-version preview disabled. Configuring only the running CMS container does not change the compiled UI. Deploy and configure the exact 1.0.3 preview renderer and its CSP before enabling that origin.

Run the 1.0.3 renderer with `NUXT_PUBLIC_PREVIEW_ADMIN_ORIGIN` set to the exact CMS admin origin (scheme, hostname and port). A preview-only renderer needs no Gateway credentials. Separately allow its exact origin in the CMS response CSP `frame-src`; the renderer supplies `frame-ancestors <CMS admin origin>`. Avoid wildcard origin policies. This change does not modify server CSP or deployment configuration.

The new image still needs a separate immutable release/registry publication, and the CMS site must explicitly adopt 1.0.3. Neither this configuration nor merging the source code upgrades an installed/active site.

## Message contract

The iframe `/preview` sends:

```js
{ type: 'storefront:preview-ready', templateId: 'aeroframe', templateVersion: '1.0.3' }
```

CMS verifies both `event.origin` and `event.source === iframe.contentWindow`, plus those template fields for external preview. A matching type string alone does not authorize delivery. For the old built-in renderer, the existing `{type:'storefront:preview-ready'}` handshake remains supported.

After verification CMS sends `{type:'storefront:preview', payload: <authenticated preset-site snapshot>, path?: '/catalog'}` to the exact iframe origin. No JWT or Gateway credential is sent. Draft media keeps the private short-lived media capabilities supplied by authenticated CMS preview endpoints. The renderer also validates its actual parent source and the configured CMS admin origin.

A ten-second handshake timeout displays a recovery message. Refresh whole-site preview, or close/reopen page preview, to retry after correcting configuration. On close/unmount, timers/listeners and local payload refs are cleared. The renderer keeps payloads only in memory, expires them after ten minutes and serves the preview shell with no-store/noindex headers. The iframe supports navigation only among snapshot pages.

## Unsaved single-page scope

`PagePreview` still requests the unsaved Entry through authenticated `POST /api/v4/storefront/page-preview`. For 1.0.3 it also fetches the authenticated saved site snapshot, overlays the selected page content, preserves its saved items, and sends the resulting full snapshot with the selected path. The UI explicitly states that the current page includes unsaved edits while URLs, related cards and other pages use saved draft data.

The authenticated user must be allowed to read the site snapshot (including all selected content models). The selected page must already exist in the saved snapshot and the requested language must match it. Newly unsaved/unbound/disabled pages, incompatible language snapshots or incomplete saved site content show an explicit error and require saving/correcting the draft first. No fabricated route or public draft API is introduced. Editing site settings overlays only the selected preview page; inspect the saved whole-site preview to verify all pages after saving.

The pre-existing `product-preview.tsx` and built-in `storefront/app/pages/preview.vue` remain untouched.

## Local checks on 2026-10-28

`node --experimental-strip-types --test ui/test/template-preview.test.mjs` exercises renderer selection, mixed/unsupported identities, canonical origins, actual iframe source checks, renderer version verification, selected path delivery and the unsaved-page overlay boundary. UI type checking, the complete UI unit suite and production build are run separately. Live browser/CMS/renderer round-trip, configured CSP and released image adoption remain environment checks; local unit/build results do not establish them.
