# Gateway-managed independent storefronts

**Status:** reviewed architecture and phase-1 scope; implementation gates remain open
**Date:** 2026-10-25
**Supersedes for new development:** `2026-10-24-preset-registry-design.md` where it assumes that new layout/interaction code must be deployed with the shared Storefront. The earlier document remains a reference for declarative content, immutable versions, validation and explicit upgrades.

## Outcome and scope

A platform-team template release (including new layouts and interactive components) becomes selectable without redeploying CMS or any existing storefront. A CMS user selects a template, edits content and clicks Publish; the platform creates or updates an accessible, isolated storefront instance. Phase 1 supports both a platform subdomain and verified custom subdomains or apex domains with HTTPS. CMS users do not build images or operate Docker.

Phase 1 is content/site building only: no orders, payments, members, arbitrary user-uploaded code, or user-managed hosting. Template code is authored and reviewed by the platform team in a separate template project. One template image digest may run many per-site instances; every site is assigned one instance (or a replacement instance during rollout). Existing sites are never silently upgraded.

## Repository locations

- Template repository: https://github.com/tangtianshuo/Independent-Website-Templates.git
- Gateway repository: https://github.com/tangtianshuo/Independent-Website-Gateway.git

These are separate repositories and deployment boundaries. Recording their addresses here does not imply that local work has been pushed or that either service is deployed.

## Boundaries

- **CMS (content authority):** workspace permissions, draft models/pages/media, template choice, editing, preview, immutable Release creation, and a UI for deployment/domain status. It does not hold Docker credentials or serve public draft content.
- **Template project and registry (code authority):** CI tests and builds versioned, signed/approved OCI images plus a declarative CMS content schema/manifest, example content, template compatibility and digest. The registry makes approved immutable `templateId@version -> imageDigest, manifestChecksum` available to CMS and gateway independently of either application deployment. Previously referenced artifacts remain resolvable.
- **Platform gateway control API (runtime authority):** stores site-to-template pin, deployment operation, release pointer, domain binding and routing revision; accepts authenticated, idempotent requests from CMS and orchestrates reconciliation. It does not become the editable content source or contain the template's page code.
- **Deployment worker:** a separately privileged component pulls allowlisted immutable image digests, starts per-site containers, checks readiness, updates routes and cleans old instances after a rollback window. CMS, gateway public API and storefronts have no Docker Socket access.
- **Ingress and public gateway data API:** ingress terminates TLS and forwards the validated Host to a route bound to a site instance; the data API serves only that site's published snapshots/media using a site-scoped workload identity. Neither needs CMS online for existing published pages. Separate scaling and availability of ingress/data plane from the control API/worker; a control-plane outage must not block already-live sites.
- **Storefront instance:** runs the approved template image, keyed to a single site; its SSR/runtime requests use the gateway data API and never CMS admin APIs or database credentials. No separate CMS backend or database is required per site.

```text
Platform team -> template CI -> immutable image + manifest -> registry
CMS editor -> CMS drafts -> Release + publish intent -> gateway control API
                                                   -> deployment worker -> site containers
Visitor -> TLS ingress -> domain route -> one site container -> published gateway API
                                          (site-scoped identity and cached snapshot)
```

This is a logical service boundary, not a requirement for every box to be a separate host. The CMS and platform gateway are separate ownership/deployment units; the gateway may internally split control, worker and data endpoints. Start with one Docker host and an ingress that supports atomic route changes; do not expose the Docker daemon over the network or mount it into the CMS. Plan capacity for per-site memory, quotas and host failure before accepting production workloads.

## Contracts and lifecycle

### Template publication

CI validates manifest schema, stable field/page keys, media integrity, CMS compatibility and allowed runtime capabilities; tests desktop/mobile preview and the image health endpoint. It scans and reviews image dependencies, signs/records provenance, publishes by immutable OCI digest and only then marks a matching registry record `available`. A tag is display metadata, never a deployment identity. Registry removal of an image or manifest referenced by a site or Release is prohibited. New template code is deployed only into newly created or explicitly upgraded site instances; code is never uploaded through CMS.

CMS imports the manifest into draft models/pages using stable keys. A site pin includes template ID, version, manifest checksum, image digest and schema/compatibility revision. CMS editors can alter content and supported configuration, not the running template source. If a template needs new CMS features, registry validation blocks it until the CMS API supports the contract.

### Create and publish

1. CMS creates draft site content and reserves a platform subdomain; a gateway allocation records a unique site/workspace binding. A draft has no public content.
2. CMS builds and stores an immutable, site-scoped Release, validates its compatibility with the pinned manifest, then submits an idempotent publish intent containing site identity, release ID/checksum and the expected active revision. Gateway authenticates the CMS service identity and independently verifies the Release's site/workspace and checksum before accepting it.
3. Gateway durably records the operation and desired state. Worker verifies the approved image digest, starts a site container with a short-lived site-scoped credential, and fetches/stages the immutable Release into the gateway's durable published snapshot store. Published media required by that Release must remain addressable and authorized.
4. Worker probes health and a representative page using the staged Release and assigned Host. Only after both instance and data are ready does it atomically switch the active tuple `(site, image digest, release ID, route revision)` and route traffic. Status returns `pending`, `ready` or `failed` with a useful reason; CMS polls/receives the result and never reports success at mere request acceptance.
5. A content-only subsequent publication stages a new Release and atomically changes the active Release pointer without rebuilding the image or necessarily replacing the container. Template upgrade stages a new instance, previews changes and switches image + Release together after explicit approval.

An initial publish failure leaves the site unpublished; a replacement failure leaves the previous tuple, route, image and Release serving. Repeated intents with the same operation key return the same operation; concurrent revisions conflict rather than overwrite. Rollback activates a previously retained, compatible tuple after readiness checks. Recovery reconciles recorded desired/actual state after worker restart. If a published snapshot cannot be served, keep the last verified active snapshot rather than falling back to CMS drafts.

### Routing, domain and trust

A platform-owned wildcard subdomain is automatically bound to the site, with a TLS strategy configured at ingress. For custom subdomains use a CNAME to the ingress hostname; for apex domains provide supported ALIAS/ANAME or A/AAAA targets. In both cases prove ownership using a unique TXT challenge, verify target DNS and complete certificate issuance before activating the binding. CMS displays instructions/status; gateway owns binding, globally unique hostname reservation, TLS and route state. Renewal/revalidation failures alert operators and do not disable the platform subdomain. Custom-domain failure cannot remove the active route of another site. Existing primary-domain semantics are preserved through migration, including redirect/canonical host behavior.

Ingress strips spoofable site/identity headers and passes the normalized, validated Host only to an existing verified route; unknown hosts fail closed. Storefront workloads authenticate to the gateway data API with per-site credentials issued by the platform (rotatable, no CMS admin token). Gateway authorizes every content/media lookup against the workload's bound site and active Release; untrusted browser-provided site IDs or Host headers do not grant access. Separate draft-preview credentials and routes from public snapshots. Rate limits, resource limits and egress policy apply to site containers; templates receive no infrastructure secrets.

## Migration from this repository

Production Compose currently deploys one fixed `storefront` and an Nginx `storefront-gateway` forwarding to it; the latter is an ingress proxy, not this new control/data service. CMS currently owns `SiteInstallation.currentReleaseId`, release publication/rollback and domain verification/resolution. Preserve these interfaces during transition; do not relabel the existing proxy as a full gateway.

1. Freeze current site IDs, Release snapshot shape, domain records and working public routes as a compatibility baseline. Introduce gateway identity and immutable template/image pin while old sites continue on the shared Storefront.
2. Extract approved template images and manifests into their own CI/repository. Stand up a registry and gateway with durable deployment state and snapshot replication. Establish gateway-to-CMS authenticated Release fetch or push, with retries and checksum validation; avoid dual authoritative public pointers. Deploy and validate per-site instances, ingress and atomic route changes before directing CMS publications to them.
3. Make new CMS publish requests use gateway operations; expose true asynchronous status and retry/rollback in CMS. Complete the platform-subdomain selection, edit and publish pilot, then verify custom subdomain and apex ownership, routing and HTTPS.
4. Shadow/canary migrate one noncritical legacy site and then the remaining sites; validate TLS, routing, content parity, media, primary-domain semantics and rollback. Keep old shared routing until each migrated site's new route is verified, then switch per site. Only after all old sites are migrated, retained Releases remain readable and production failure/recovery drills pass may shared Storefront and legacy routing paths be retired in a separate cleanup.

## Failure and acceptance gates

- A new platform-owned template with a novel layout and interactive component can be reviewed, published and installed with **no CMS or existing Storefront redeploy**; two sites can use one image digest with isolated data.
- From CMS selection through edit/preview/Publish, a new site becomes available on its platform subdomain. Custom subdomain and apex bind only after TXT ownership, DNS targeting and HTTPS success.
- Published pages stay available if CMS or control/worker is down; drafts and another site's Release are inaccessible through public gateway/API or a forged Host/site ID.
- Invalid/unapproved digest, incompatible manifest, missing artifact/media or failed health check cannot become active. Repeated, concurrent and interrupted publish requests converge on one correct operation; failed upgrades preserve the old site; explicit rollback works.
- Existing sites remain unchanged until individually migrated; catalog updates alone never rewrite a pin or active Release. Gateway reports deployed image digest, Release ID and route revision so operators can audit each site.
- Phase 1 is complete only after capacity, backup/restore, certificate renewal and host-failure recovery drills on the single-host deployment, plus per-site migration with old routes available until verified cutover. The stage-4 platform-subdomain pilot is not production completion.

The original Git-bundled preset registry can still serve as a migration/test fixture, but cannot be the final release path: phase-1 acceptance requires dynamic template/image publication and a gateway-managed instance. The original declarative-only and shared-theme-runtime restriction is intentionally replaced for platform-authored, reviewed images; it remains appropriate for any future untrusted submissions.
