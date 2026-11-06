# Storefront domain setup (D1)

For dynamically provisioned sites, Gateway owns domain verification, active routes and publication state. CMS resolves the persisted source binding and forwards authenticated operations. The legacy-only flow below continues to use CMS domain bindings. Your DNS provider, CDN or hosting platform maintains DNS records, TLS certificates and renewal. CMS never edits DNS or requests certificates. Domain changes and content rollback are independent.


## Dynamically provisioned sites (C4)

Configure `PLATFORM_DOMAIN` once on Gateway control. C1 reserves an immutable exact `SourceSiteBinding.defaultDomainId`; its HTTPS URL survives primary changes and configuration drift. Do not delete, repurpose, rename or infer the default row from a hostname prefix. Default-domain ownership comes from that exact binding; custom domains require the one-time TXT proof.

Gateway control and traffic receive the same server-only `STOREFRONT_DOMAIN_SECRET`. Configure `STOREFRONT_DOMAIN_ENTRY_HOST` and/or `STOREFRONT_DOMAIN_ENTRY_IP` on control with the **actual** ingress DNS values. Empty values mean configuration is incomplete; they do not imply a working connection. Both services remain private behind the HTTPS edge. The worker projects enabled reserved hosts atomically into `domains.json` beside `GATEWAY_ROUTE_STATE_PATH` (override writer with `GATEWAY_DOMAIN_STATE_PATH`; configure the traffic snapshot path consistently). Share the same persistent directory with traffic. This file grants only `/.well-known/cms-domain-challenge`, never public content. An unpublished site's `/` remains 404.

Provision wildcard DNS and valid HTTPS for the platform suffix externally before first publication. `nova-relay.conf` contains a deployment example for `sites.novaintelligent.cn`, forwarding its wildcard and explicitly listed custom hosts to traffic on port 18180; align this example with the actual platform suffix and traffic listener. Unknown hosts remain 404. Add custom-host TLS and an explicit edge/relay host entry before checking it. No ACME, domain purchase, production migration or certificate issuance is performed by this code.

The same CMS `/site-domains` actions now use Gateway for provisioned sites, with trusted source headers from the stored binding. Pending provisioning and control outages fail closed; they never mutate legacy Mongo domain rows. Legacy-only sites retain the historical flow below. Gateway's GET exposes independent ownership/DNS/certificate state, actual ingress guidance, and a durable `operation` result. Every check requires current positive ownership, DNS and HTTPS proof. TLS uses hostname validation and a pinned globally routable DNS address, port 443, no redirect, and bounded response/time. TXT digests are stored; raw values are shown only on reservation and expire after 24 hours if still unverified.

Primary/state/remove return **pending**, not active success. A small `DomainChange` row is durable per site. Under the same Site serialization boundary used by publication creation, a pending publish excludes domain changes and a pending domain change excludes publication. The worker alone updates the durable route file; it verifies the existing runtime at the new host before and after route apply and then commits primary flags and Deployment host. Failure restores the committed route and leaves the old primary. Crash replay uses the committed Domain rows to reconstruct rollback, and replays pending intent even when its route was written before SQL commit. An ambiguous COMMIT retains the verified route and retries/converges rather than falsely reporting failure. Keep one worker/router owner per route-state directory, as required by the existing local-router architecture; the Site SQL exclusion also fences competing same-site domain workers.

The exact reserved default and current primary cannot be removed or disabled. Switching primary does not change the immutable content release or publication revision. Ready aliases redirect 301 preserving path/query; challenge runs before this redirect. The UI polls pending changes, reports failure without changing the primary, and prevents promotion while the certificate is unready.

### C4 disposable local proof and formal gate

Build the current Templates aeroframe source image with its exact `SOURCE_COMMIT` revision label as `local/c4-aeroframe:source`, build current Gateway traffic/worker, then run from the CMS worktree:

```sh
E2E_C4_MODE=local \
E2E_GATEWAY_ROOT=/absolute/managed/Gateway \
E2E_TEMPLATES_ROOT=/absolute/managed/Templates \
E2E_DATABASE_ENV_FILE=/absolute/owned/runtime.env \
E2E_RUNTIME_DIR=/absolute/new/private/c4-run \
node ops/e2e/site-provisioning.mjs
```

The fixture uses the explicitly owned PostgreSQL15432 and Mongo27029 endpoints, fresh random databases, random application ports, production CMS main/jobs and persistent C3 source bindings, production Gateway handlers over a local HTTP adapter, real worker/Docker candidates, a per-run local CA and normal certificate/SNI verification. Loopback DNS/TXT are explicit fixture adapters. The one local TemplatePin uses the genuine Docker image ID; release/publish intake is through scoped Gateway handlers. This does **not** prove CMS publicRecord/preset→public OCI, deployed Next HTTP routing, Internet wildcard DNS/TLS or an accepted immutable public platform lock. Those external/formal gates remain blocked until independently supplied and verified; local success cannot satisfy them. No per-site binding environment variables are used. Evidence records source hashes, TLS negatives, two distinct first publications, domain switch/redirects and cleanup.

## Private origin and configuration

Generate **two different** random 32-byte hex secrets (for example `openssl rand -hex 32` twice). Put them in deployment secrets, never browser public runtime config:

| Backend | Storefront server | Purpose |
| --- | --- | --- |
| `STOREFRONT_GATEWAY_SECRET` | `NUXT_GATEWAY_SECRET` | Private gateway and CMS requests |
| `STOREFRONT_DOMAIN_SECRET` | `NUXT_DOMAIN_SECRET` | Signed HTTPS challenge |
| `STOREFRONT_ENTRY_HOST` | — | Stable public ingress hostname shown in configuration guidance |
| `STOREFRONT_ENTRY_IP` | — | Optional public ingress IPv4 for root A records |
| `STOREFRONT_HOST` | `NUXT_PUBLIC_SITE_HOST` | Legacy host / explicit local development host |
| `NODE_ENV=production` | `NUXT_DOMAIN_PRODUCTION=true` | Fail closed for untrusted requests |

Use the production Compose `storefront-gateway`, whose template is `proxy/storefront.nginx.template`. An external TLS proxy/Cloudflare Tunnel forwards to its loopback port (default 3000), preserves the actual HTTP Host, and bypasses page/API caching. The gateway overwrites `X-Storefront-Host` and `X-Storefront-Key` and clears user forwarded host/proto. Nuxt requires matching actual Host and gateway host plus the shared secret. Nuxt sends that verified host and secret to the private CMS API. CMS never resolves a public caller's site ID. Keep direct Nuxt and backend ports private; do not pass the gateway secret from clients. The CMS proxy clears these private context headers from browser requests.

Production refuses public routing if gateway configuration is missing. The only development exception is the exact configured `localhost[:port]` or `127.0.0.1[:port]`, with `NODE_ENV` other than production and `NUXT_DOMAIN_PRODUCTION=false`. Merchant bindings never accept localhost, IP literals, ports, paths, credentials or wildcard hosts. Forwarded proto is ignored; merchant canonical URLs always use HTTPS.

## Add and check a domain

Domain management uses the server-verified `x-bcms-workspace` and `x-bcms-site` selectors. A persisted instance `ADMIN`/`SUDO`, or an `admin` member of the selected workspace, may manage that site's bindings. `SUDO` must exist on the latest database User record; a token-only claim is not accepted. Selectors and domain names locate resources but never grant authority. Template and Media content access remains subject to its own grants even for a workspace member administrator.

The management UI is available at `/d/domains`. Select a workspace and site first, then add, check, promote, enable/disable or unbind domains. The UI keeps the TXT value only in component memory, refreshes server state after success and failure, and surfaces 409/429 recovery guidance. A full workspace/site switch retires old requests and sockets and reloads the dashboard; unsaved editor state is intentionally discarded.

1. `POST /api/v4/site-domains` with `{ "hostname": "www.example.com" }`. Store the **one-time** `txtName`, `txtValue`, and `expiresAt` response. The token is random, its digest alone is stored, and it expires after 24 hours. The list API never returns the token or digest.
2. Add TXT `_cms-verify.www.example.com` with the returned `cms-verify=...` value in the external DNS platform. Retain it until ownership succeeds. For a `www` host, create CNAME to the supplied `STOREFRONT_ENTRY_HOST`. For root domains, use provider ALIAS/ANAME flattening or A to `STOREFRONT_ENTRY_IP`. Do not CNAME to the CMS admin host. Both root and www need individual bindings and TXT validation.
3. Provision valid HTTPS externally and forward the actual Host to the private gateway. Cloudflare proxy mode may be on; readiness checks use DNS resolvability and a signed HTTPS challenge, **not** equality with the origin IP. Use Full (strict) TLS when Cloudflare connects to an HTTPS origin. Resolve external certificate issues at your hosting platform.
4. `POST /api/v4/site-domains/:id/check`. Inspect ownership, DNS and HTTPS independently: `ownershipStatus`, `dnsReady`, `connectionStatus`, `lastError`, `lastCheckedAt`, `lastSuccessAt`. TXT propagation or DNS outages and certificate errors include actionable messages. Retry no sooner than 10 seconds. Checks reserve attempts in MongoDB and have four-second DNS/HTTPS timeouts. DNS destinations must all be global public IPs; HTTPS pins the resolved IP while preserving TLS SNI/certificate validation, uses only port 443 and the fixed challenge path, and never follows redirects. Private, loopback, mapped, link-local, multicast and documentation ranges are refused.
5. Set a ready, verified, enabled binding as primary with `POST /api/v4/site-domains/:id/primary`. Existing aliases serve that same site's current Release and public pages redirect 301 to the primary host, preserving safe paths and queries. The API, challenge and preview routes do not receive alias redirects. No published Release means public 404; drafts are never substituted.

`GET /api/v4/site-domains` provides current items, derived `isPrimary`, pointer, revision and entry guidance. `POST /:id/state` with `{ "enabled": false }` immediately disables an alias; `DELETE /:id` unbinds an alias and revokes its credential. Switch to a verified replacement before disabling or unbinding the primary. Rebinding issues a new token. A 409 conflict requires reloading server state. The site pointer is authoritative; concurrent primary mutations cannot produce two primary hosts. A transient recheck error retains prior ownership and last success, and never changes primary/content pointers.

HTML, public JSON, sitemap and domain management replies use `no-store`. Create Cloudflare Cache Rules to **bypass cache** for all public HTML, `/api/*`, `/.well-known/cms-domain-challenge` and `/sitemap.xml`. Disable Cache Everything / APO for this origin. Binding and content changes take effect on the next request; no Cloudflare API token is needed.

## Explicit migration of an already provisioned production hostname

Before enabling production domain routing, back up the database, verify the existing external domain is under your control and its DNS/TLS point at this gateway, and identify the installed site `_id`. With the deployment DB configuration and both secrets loaded, run from `backend/`:

```sh
STOREFRONT_MIGRATE_HOST=www.example.com \
STOREFRONT_MIGRATE_SITE_ID='<installed-site-id>' \
STOREFRONT_MIGRATE_CONFIRM=externally-provisioned \
node -r ts-node/register -r tsconfig-paths/register src/site-domains/migrate.ts
```

For a compiled production image use `node dist/site-domains/migrate.js` with the same environment. This is an explicit operator attestation for the existing provisioned host; it does not make external DNS changes, perform a publication or copy content. It refuses another site's binding or an existing pending record. A new binding becomes primary only if no pointer exists. Retrying an eligible existing migrated binding finishes a missing initial promotion; a primary established before or during that retry is preserved. Regular new merchant domains must use TXT/HTTPS checks instead. Migrate before switching traffic so the existing public URL remains available.

Expired pending records remain visible for seven days after their token expires. Remove/re-add them to receive a new token sooner. Periodically clean them up using the deployment DB and secrets:

```sh
node dist/site-domains/migrate.js --cleanup-expired
```

Only expired, still-pending bindings are deleted; verified bindings and release history remain. Primary changes atomically persist pointer, binding revision and a committed audit event in the site `domainAuditOutbox`. The event includes actor/site/domain/outcome/revision and remains there until idempotent projection into the audit collection is acknowledged. A failed atomic commit retains the prior primary. A projection outage returns the committed success and logs deferred projection; the next domain list or primary operation retries delivery. Other audit entries remain in the site domain audit collection. Migration, add, check, primary, enable/disable and unbind record actor/site/domain and outcome. No caches of bindings are reused across requests.

## Workspace migration, sharing and media operations

Legacy content belongs only to the default workspace. Before enabling the final workspace indexes, stop writers and preview EntryGroup migration conflicts from `backend/` with an explicit database URI:

```sh
BCMS_ENTRY_GROUP_MIGRATION_MONGO='mongodb://127.0.0.1:27028/explicit_database' \
node -r ts-node/register -r tsconfig-paths/register src/entry-groups/preview.ts
```

The preview does not write, rename or delete content. Resolve every conflict explicitly before startup migration. Do not run the migration concurrently with application writers.

Cross-workspace copies require explicit fixed-version grants for the root and every dependency. Target records remain hidden behind a durable batch barrier until the full graph commits. A failed or indeterminate copy can retain workspace, EntryGroup and share-use permits. Before operator recovery, isolate the original writer and prove every issued database/storage operation can no longer commit; never clear permits based only on elapsed time or process exit.

Private editor media URLs use 15-minute capabilities and dashboard/iframe previews refresh them before expiry. Published Release URLs remain stable and do not contain JWTs or capabilities. Release and copy references conservatively block physical media deletion; unused retention markers and revoked share snapshot files do not yet have automatic garbage collection.

## Local verification

Domain tests use random isolated databases and random application ports and drop their databases afterwards. They never alter live DNS or certificates:

```sh
cd backend
STOREFRONT_ENABLED=true STOREFRONT_GATEWAY_SECRET=test-secret \
STOREFRONT_DOMAIN_SECRET=test-challenge-secret \
STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 STOREFRONT_TEST_SSR=true \
node -r ts-node/register -r tsconfig-paths/register --test src/site-domains/*.test.ts src/storefront/*.test.ts
```

Build `storefront/` before enabling SSR integration. The historical D1 tests exercised real Mongo indexes/pointers and built Nuxt HTTP rendering through simulated trusted gateway requests; DNS/HTTPS result fixtures were controlled adapters, not production DNS calls. The later workspace, content-isolation, sharing and management changes are not covered by that historical result. The management UI is implemented, but final-code browser, database/concurrency, failure-recovery and external DNS/TLS acceptance remain unexecuted and are required before production use.
