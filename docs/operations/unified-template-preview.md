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

## Early B3 browser foundation (local only)

`ops/e2e/browser-fixture.mjs` exports `login(page)` and Playwright `test`, `expect`.
The actual CMS login route is `/`; the controls are the accessible 邮箱/Email,
密码/Password and 登录/Log in controls. Login waits for the 工作台 heading.
The worker authenticates in a separate unrecorded Chromium context, then creates a
mode-0600 storage-state file in an ignored mode-0700 directory. It removes that
file when the worker ends. Test pages start after authentication. One worker runs
both 1440×900 desktop and 390×844 mobile projects.

Prerequisites: Node 22, existing CMS root/backend/UI dependencies, Docker with the
owned disposable A1 Mongo service healthy on `127.0.0.1:27029`, and the Preview
source checkout. This stage pins `@playwright/test` to `1.65.0` in the root lock.
Install its browser once with `npx playwright install chromium`.

From the isolated CMS checkout:

```sh
E2E_DATABASE_ENV_FILE=.superpowers/sdd/2026-11-06-platform-delivery-master/a1-runtime/runtime.env \
E2E_PREVIEW_ROOT=/absolute/path/to/assigned/Independent-Website-Preview \
node ops/e2e/browser-runtime.mjs run -- node ops/e2e/preview-roundtrip.mjs --foundation

E2E_DATABASE_ENV_FILE=.superpowers/sdd/2026-11-06-platform-delivery-master/a1-runtime/runtime.env \
E2E_PREVIEW_ROOT=/absolute/path/to/assigned/Independent-Website-Preview \
node ops/e2e/browser-runtime.mjs run -- node --test ops/e2e/browser-fixture.test.mjs
```

The helper builds the current UI into `.e2e/runtime/ui/dist`, runs the current CMS
TypeScript source with its existing ts-node runtime, and runs the actual Preview
source against an empty approved registry. CMS uses `http://127.0.0.1:18088` and
Preview uses `http://127.0.0.1:18089`; a busy port is rejected without stopping its
owner. Each invocation creates a new `b3_browser_<random>` Mongo database,
administrator, workspace and site through the actual setup APIs. Its built-in
`aeroframe@1.0.0` installation is exclusively an unavailable-renderer baseline.
It does not represent the new candidate versions or a public release. Source
metadata identifies the current working tree, base commit and tracked diff digest;
it does not attribute the old A4 Docker image to the current CMS source.

`run` injects credentials directly into its child process. `serve` keeps the same
setup alive for interactive work until SIGINT/SIGTERM. While alive, private injection
is in `.e2e/runtime/runtime.env`; never print, attach or commit it. Normal completion,
command failure and SIGINT/SIGTERM stop only helper-owned processes, drop only that
invocation's database, and remove private auth, logs and generated build output.
The A1 Mongo/PostgreSQL containers keep running. A lease rejects concurrent helper
invocations. After an uncatchable process kill, inspect the owned processes and
source-baseline database identity before removing a stale lease; do not stop shared
services. Evidence and source metadata stay under ignored `.e2e/`.

For a later selected unpublished candidate, import the exported `test` in another
`ops/e2e/*.spec.mjs` and inject the actual `STOREFRONT_E2E_CMS`,
`STOREFRONT_E2E_EMAIL`, `STOREFRONT_E2E_PASSWORD`, plus both
`STOREFRONT_E2E_WORKSPACE_ID` and `STOREFRONT_E2E_SITE_ID`. An omitted selector uses
the account's actual current selection. `installation` reads the selected site
identity; `siteUrl` requires a real `STOREFRONT_E2E_SITE_URL` and has no invented
published fallback. The baseline `preview.spec.mjs` deliberately requires an empty
registry; ready-renderer interaction tests belong to B4–B7 and must select their
actual candidate installations. Private/result directories can be set with
`STOREFRONT_E2E_PRIVATE_DIR` and `STOREFRONT_E2E_RESULTS_DIR`; use ignored private
paths and keep the existing evidence policy.

Controller security ruling for this early stage: trace/HAR/video would retain
Authorization, cookies or session tokens, so they are disabled. Automatic raw DOM
error snapshots are disabled with the pinned runner's `PLAYWRIGHT_NO_COPY_PROMPT`;
the real security checks verify that retained diagnostics omit the account email,
password and JWTs. Product failures attach a screenshot masking email text and
password/email inputs, plus a fixed diagnostic. Login failures attach no screenshot
or recording and replace potentially credential-bearing locator errors with a
fixed message. Do not enable trace or attach raw storage state to replay this stage.
A credential-safe retained trace remains a final B3 requirement.

`preview-roundtrip.mjs --foundation` propagates browser failures and, on success,
reports only `local-browser-foundation-not-acceptance` with
`overallB3Complete:false`. Without `--foundation`, the acceptance entrypoint stays
nonzero even when the local foundation passes. Neither mode creates passing formal
AcceptanceEvidence. The full two-template/new-version matrix, B7 unsaved live
canvas, page/image/rich-text interactions, save/publish equality, complete version
lock and edge/deployment checks remain incomplete.
