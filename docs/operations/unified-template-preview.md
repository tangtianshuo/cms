# Unified template preview

CMS resolves private preview renderers from one preview service. Templates are immutable
static bundles, selected by exact `templateId@templateVersion`.

## Runtime flow

1. A template release builds `preview/` with Nuxt static generation.
2. `scripts/preview-bundle.mjs` copies the preview shell and content-hashed assets into a
   bundle with a canonical `bundleDigest`.
3. The release publishes the bundle as an OCI artifact and appends
   `registry/preview/index.json`.
4. The preview host extracts the approved bundle under
   `{PREVIEW_BUNDLES_ROOT}/{id}/{version}`.
5. CMS backend calls the preview host resolver and verifies the returned URL, template
   identity, protocol version and digest before giving it to the browser.

The browser still sends drafts directly to the iframe through the existing
origin-checked `postMessage` protocol. Draft content never passes through the preview
host.

## CMS configuration

Set only one server-side URL:

```dotenv
STOREFRONT_PREVIEW_SERVICE_URL=https://preview.novaintelligent.com
```

The legacy build-time variables remain during migration:

```dotenv
VITE_TEMPLATE_PREVIEW_ORIGIN=
VITE_TEMPLATE_PREVIEW_RENDERERS=
```

`STOREFRONT_PREVIEW_SERVICE_URL` is read by the CMS backend at startup. After changing
it, redeploy or recreate the CMS backend service with the new environment; rebuilding
only the UI does not apply this setting. The production Compose file forwards this
variable to the backend. Use a canonical HTTP(S) origin without a trailing slash,
credentials, path, query or fragment.

The authenticated `GET /api/v4/storefront/preview-runtime` endpoint derives the template
identity from the selected, authorized SiteInstallation. Browser query identity must
match that installation. Responses use `Cache-Control: no-store`:

- `status: ready` includes the validated runtime descriptor and `configured: true`.
- A resolver 404 returns `status: unavailable`, the installed template identity,
  `runtime: null`, and `configured: true`. The UI displays “该模板版本尚未提供预览”.
- Service failure, timeout, redirect or invalid descriptor returns HTTP 503 with
  “预览服务暂时不可用，可重试”. Internal URLs and transport errors stay out of responses.
- Only an unset server URL returns `status: legacy`, `configured: false`, and
  `runtime: null`, allowing explicit migration via the existing exact renderer map.

Once the unified service is configured, a missing or failing renderer never falls
back to a per-template mapping or another version. Remove per-template origins after
every active template version resolves through the unified service.

Every versioned renderer must announce `storefront:preview-ready` with its exact
`templateId`, `templateVersion`, and `protocolVersion: 1`. The browser also verifies
the message origin and current iframe window before sending a draft, and sends only
to the descriptor URL's origin. Changing site or renderer retires the old descriptor
and handshake. Preview iframes use a script/same-origin sandbox and no referrer.
Legacy versioned renderers that do not announce protocol 1 require a new approved
preview bundle; published version directories must not be rewritten.

## Preview host configuration

```dotenv
PREVIEW_PUBLIC_ORIGIN=https://preview.novaintelligent.com
PREVIEW_ADMIN_ORIGIN=https://cms.novaintelligent.cn
PREVIEW_REGISTRY_PATH=/opt/novaintelligent/preview/registry/preview/index.json
PREVIEW_BUNDLES_ROOT=/opt/novaintelligent/preview/bundles
```

The CMS reverse proxy must allow the exact preview origin in `frame-src`. The preview
host independently sets `frame-ancestors` to the exact CMS origin.

## Bundle layout

```text
bundles/
  fireguard/1.0.0/
    preview-bundle.json
    index.html
    _nuxt/
```

`preview-bundle.json` records every file checksum and the aggregate digest consumed by
the registry. A version directory is never rewritten after its registry record becomes
available. A preview-only code fix also receives a new template patch version; this keeps
template, production image and preview bundle identity aligned.

Registry records keep both digests:

- `artifactDigest` identifies the immutable OCI artifact pulled by the deployment host.
- `bundleDigest` identifies the unpacked bundle content verified by the preview service.
