# Storefront domain setup (D1)

CMS maintains domain bindings and immutable publication pointers. Your DNS provider, CDN or hosting platform maintains DNS records, TLS certificates and renewal. CMS never edits DNS or requests certificates. Domain changes and content rollback are independent.

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

All management endpoints require an ADMIN session. In D1 the authorized site's source is the installed default site; no caller-supplied site ID is accepted. Later workspace scope is supplied through the source adapter, preserving these interfaces.

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

## Local verification

Domain tests use random isolated databases and random application ports and drop their databases afterwards. They never alter live DNS or certificates:

```sh
cd backend
STOREFRONT_ENABLED=true STOREFRONT_GATEWAY_SECRET=test-secret \
STOREFRONT_DOMAIN_SECRET=test-challenge-secret \
STOREFRONT_TEST_MONGO=mongodb://127.0.0.1:27028 STOREFRONT_TEST_SSR=true \
node -r ts-node/register -r tsconfig-paths/register --test src/site-domains/*.test.ts src/storefront/*.test.ts
```

Build `storefront/` before enabling SSR integration. Tests exercise real Mongo indexes/pointers and real built Nuxt HTTP rendering through simulated trusted gateway requests; DNS/HTTPS result fixtures are controlled adapters, not production DNS calls. UI management is scheduled in umbrella Task 6 alongside workspace/site scope.
