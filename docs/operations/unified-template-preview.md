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

Configure the resolver and the exact public iframe origin together:

```dotenv
STOREFRONT_PREVIEW_SERVICE_URL=https://preview.novaintelligent.com
STOREFRONT_PREVIEW_PUBLIC_ORIGIN=https://preview.novaintelligent.com
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

-   `status: ready` includes the validated runtime descriptor and `configured: true`.
-   A resolver 404 returns `status: unavailable`, the installed template identity,
    `runtime: null`, and `configured: true`. The UI displays “该模板版本尚未提供预览”.
-   Service failure, timeout, redirect or invalid descriptor returns HTTP 503 with
    “预览服务暂时不可用，可重试”. Internal URLs and transport errors stay out of responses.
-   Only an unset server URL returns `status: legacy`, `configured: false`, and
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

The CMS reverse proxy renders `frame-src 'self'` when preview is unconfigured. If the
service URL is set, `STOREFRONT_PREVIEW_PUBLIC_ORIGIN` must be an explicit canonical
HTTP(S) origin. Missing or malformed required origins stop nginx startup. Wildcards,
credentials, paths, line breaks and header injection are rejected. Development and
production Compose forward both values; production mounts the stock nginx startup
renderer and config template. The preview host independently sets `frame-ancestors`
to the exact CMS origin. This changes neither DNS nor certificates.

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

-   `artifactDigest` identifies the immutable OCI artifact pulled by the deployment host.
-   `bundleDigest` identifies the unpacked bundle content verified by the preview service.

## Disposable local browser runtime

`ops/e2e/browser-fixture.mjs` exports `login(page)` and Playwright `test`, `expect`.
The actual CMS login route is `/`; the controls are the accessible 邮箱/Email,
密码/Password and 登录/Log in controls. Login waits for the 工作台 heading.
The worker authenticates in a separate unrecorded Chromium context, then creates a
mode-0600 storage-state file in an ignored mode-0700 directory. It removes that
file when the worker ends. Test pages start after authentication. One worker runs
both 1440×900 desktop and 390×844 mobile projects.

Prerequisites: a POSIX host, Node 22, existing CMS root/backend/UI dependencies, Docker with the
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
command failure and SIGINT/SIGTERM stop the helper's owned POSIX process groups,
including npm/npx descendants even after their wrapper exits. One remembered
interruption also covers setup before the serve waiter starts. Shutdown sends TERM,
then KILL after a bounded grace period, and confirms every owned group is gone
before dropping this invocation's database or removing private auth, logs, build
output and lease. A group that cannot be confirmed gone fails closed with private
resources and lease retained. Commands must preserve the inherited ownership group;
independently daemonized commands are outside this local helper's contract.
The A1 Mongo/PostgreSQL containers keep running. A lease rejects concurrent helper
invocations. After an uncatchable process kill, inspect the owned processes and
source-baseline database identity before removing a stale lease; do not stop shared
services. Evidence and source metadata stay under ignored `.e2e/`.

The ready-renderer matrix uses the actual installer, approved format and freshly built
AeroFrame1.0.4/FireGuard1.0.1 template sources. These local bundles are compiled for
`http://127.0.0.1:18088`; their digests differ from release bundles compiled for another
CMS origin. The runner archives the actual bundle, writes an OCI layout, then calls
the real archive extractor and installer. Source inventories include tracked and
nonignored untracked files and are retained next to the result directory.

```sh
E2E_DATABASE_ENV_FILE=.superpowers/sdd/2026-11-06-platform-delivery-master/a1-runtime/runtime.env \
E2E_PREVIEW_ROOT=/absolute/path/to/assigned/Independent-Website-Preview \
E2E_B3_TEMPLATES_ROOT=/absolute/path/to/assigned/Independent-Website-Templates \
node ops/e2e/preview-roundtrip.mjs --local
```

Both 1440×900 and 390×844 projects exercise exact renderer/bundle identity,
complete-site navigation, unsaved live edits, authorized real media, formatted rich
text, explicit save/reload and template mode. Media uses an owned throwaway HTTPS
proxy for actual authorized CMS capability bytes, with an explicit certificate SPKI
browser exception. The test decodes the image and checks dimensions and pixels; it
does not weaken CSP or use global certificate bypass. The saved snapshot check uses
the production contract/media projection and the actual built template runtime in
an isolated local process. It is separate from Gateway publication/public-site
acceptance. Local results explicitly block PUBLISH when no real release identity and
public-site marker are supplied. `--local` succeeds only when every feasible local
cell passes; it always reports `overallB3Complete:false`.

Native Playwright trace, HAR, video and raw DOM error snapshots remain disabled.
Authenticated failures retain a masked screenshot and fixed-schema JSON interaction
timeline: whitelisted step/lifecycle IDs and method/route enums, status and timing
only. It contains no URLs, headers, bodies, text, DOM or storage. The controlled
failure test injects actual canaries into each sensitive surface and checks retained
files and output. Login failures retain no recording or screenshot. Never attach
runtime credentials, storage state, certificate private keys or raw request dumps.

`--foundation` runs the unavailable-renderer baseline only. With neither an explicit
local mode nor the formal inputs, the entrypoint remains nonzero after a green
foundation. Formal mode requires `STOREFRONT_E2E_PLATFORM_LOCK`,
`STOREFRONT_E2E_MATRIX`, `STOREFRONT_E2E_APPROVED_PREVIEW_REGISTRY`, and exact repository roots
(the runner validates each required input and Git identity). The matrix JSON contains
`templateId`, `templateVersion`, `cms`, `previewOrigin`, `siteUrl`, `siteId`,
`workspaceId`, plus `expectedReleaseId` and `publishedMarker` for PUBLISH. Supply
actual authenticated credentials through the environment. Formal origins must use
HTTPS and real trust; local certificate/fixture overrides are cleared.

Formal evidence uses the master `AcceptanceEvidence` shape and emits only the B3
required subset. Each case binds template/version, actual viewport dimensions and
the exact lock checksum. Missing, duplicate, stale, failed, blocked or unrun required
cells make the command nonzero. PUBLISH reads actual Gateway state/history, saved
content and the real public site; it never invents a release or performs a production
write. D1 composes this subset with the other platform cases. No local invocation
creates a full passing PlatformLock acceptance result.

Preview deployment assets and the opt-in actual TLS edge test are documented in the
Preview repository README. Run `B3_EDGE_DOCKER=1 node --test
proxy/preview-origin.test.mjs` for stock-nginx startup/CSP checks. Normal unit runs do
not count skipped Docker or runtime checks as passes.
