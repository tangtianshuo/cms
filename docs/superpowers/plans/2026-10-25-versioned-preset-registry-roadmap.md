# Gateway-managed storefront delivery roadmap

**Status:** revised for review, not authorization to implement
**Design:** `docs/superpowers/specs/2026-10-25-gateway-managed-storefront-design.md`
**Historical baseline:** `docs/superpowers/specs/2026-10-24-preset-registry-design.md`

## Goal and changed assumption

Platform team publishes reviewed storefront template images (including new layouts and interaction code) independently of CMS. CMS users create and edit sites, then publish through a gateway that deploys per-site Storefront instances, distributes published content, and routes platform/custom domains. Phase 1 must end with a publicly accessible, rollback-capable independent site, not merely a catalog or preview. Orders, payment, membership and user-supplied executable templates are out of scope.

The previous roadmap's bundled Git registry, shared theme runtime and phase-5 dynamic publication are **not** sufficient for this goal. Its versioning, immutable content Releases, validation and explicit upgrade principles remain applicable. The gateway is not today's `storefront-gateway` Nginx proxy.

## Delivery sequence

| Stage | Deliverable and dependency | Exit gate |
| --- | --- | --- |
| 0. Baseline and contracts | Inventory existing presets, Release/media/domain APIs and deploy topology; define template manifest, snapshot protocol, site identity, image pin, operation states and legacy migration. | Existing sites/routes unchanged; contract and failure cases reviewed. |
| 1. Independent template pipeline | Platform-owned template project/repository, CI build/tests/security review, signed/allowlisted immutable OCI images, manifest validation and registry with artifact retention. Depends on 0. | A new layout/interaction is published without CMS or existing Storefront deploy; invalid/incompatible image cannot enter catalog. |
| 2. Gateway foundation | Separate authenticated control API, durable desired/actual state and reconciliation worker; published snapshot store/data API; per-site workload identity, tenant isolation, status/audit. Depends on 0–1. | CMS outage does not stop an existing published page; unauthorized site/Release access fails. |
| 3. Per-site deployments and ingress | Worker deploys pinned image digests with resource limits, health/page probes, atomic route revisions and retained previous instance; ingress routes by verified Host. Depends on 2. | Two sites can run one template image with isolated content; failed deployment leaves old route serving. |
| 4. CMS creation and publication | CMS installs manifest as editable draft, pins image/version, builds immutable Release and submits idempotent publish intent with expected revision; UI shows actual asynchronous state, retry and rollback. Depends on 1–3. | Select -> edit -> publish -> accessible platform subdomain works; content-only publish avoids image rebuild; rollback restores prior active tuple. |
| 5. Custom domains and HTTPS | Gateway owns unique hostname reservation, TXT proof, DNS targeting, TLS issuance/renewal and route activation for subdomains and apex; CMS shows guidance/status. Depends on 3–4. | Verified custom subdomain and apex serve correct site over HTTPS; failed validation leaves platform subdomain and old bindings intact. |
| 6. Migration and production gate | Shadow/canary migrate existing sites and Releases, preserve domain/primary semantics, run failure and capacity drills; retire shared routes only after per-site parity. Depends on 1–5. | All phase-1 acceptance tests pass and legacy sites remain reachable throughout migration. |

Stages 0–6 together are **phase 1**. Deliver an integrated pilot after stage 4, then complete stage 5 before declaring phase 1 done; do not defer custom apex support beyond that gate. Each stage gets a separate test-first implementation plan once the design is reviewed. Parallel work is possible for template CI and gateway contracts after stage 0, but integration requires one agreed manifest and Release protocol.

## Ownership and critical contracts

- **Template CI/registry:** `templateId@version` resolves to immutable `imageDigest` plus `manifestChecksum`; preserve referenced artifacts. Template project is independently versioned/deployed. Platform authors only, no arbitrary CMS code upload.
- **CMS:** drafts, media, Release creation, user/workspace authorization and editor UX remain here. Keep site IDs and Release shape stable; gateway fetches/pushes verified immutable snapshots, not drafts. CMS never gets Docker credentials.
- **Gateway control/worker:** durable idempotent `site + operationKey + expectedRevision` requests, explicit desired/actual image/Release/route tuple, authenticated reconciliation and failure status. Worker alone holds restricted deployment permissions; existing traffic stays on old tuple until new image, content and route are ready.
- **Gateway public API/ingress:** durable last-good published snapshot for CMS outages; site-scoped workload credentials and media access; no public draft/foreign-site access; independent data-plane availability during control/worker failures. Route changes are atomic by verified Host.
- **Domains:** gateway owns verification, TLS and routing; CMS reflects state. Subdomain CNAME and apex ALIAS/ANAME or A/AAAA guidance, TXT ownership check and HTTPS success precede route activation. Preserve existing primary/canonical semantics.

Current touchpoints to preserve or adapt: `backend/src/presets/catalog.ts`, `import.ts`, `site-model.ts`, `releases.ts`, `release-controller.ts`, `backend/src/storefront/published.ts`, `backend/src/site-domains/service.ts`, `storefront/`, `proxy/storefront.nginx.template` and `docker-compose.prod.yml`. Do not conflate a CMS Release rollback with an image/route rollback; gateway must record and restore their compatible tuple together.

## Test and rollout gates

- Contract tests: manifest/model keys, CMS compatibility, image digest, Release scope/checksum, event/operation idempotency, expected revision conflicts and upgrade preview.
- Isolation tests: hostile Host/headers, forged site IDs, stale workload token, cross-workspace Release/media, public draft access, missing/unapproved image.
- Failure injection: CMS offline, registry unavailable after installation, worker crash after image start, data replication failure, health check failure, routing/TLS failure, retries and concurrent publish. Prove previous page, image and Release remain live or initial site stays unpublished.
- Browser/integration: new interaction and layout without CMS/shared Storefront deploy; desktop/mobile preview; two isolated sites on one image; content-only update; first publish, upgrade and rollback; platform subdomain, custom subdomain and apex all over HTTPS.
- Migration: compare old and new site content/media/canonical routing, verify canary with rollback, track per-site deployed digest/Release/route revision and resource use. Keep legacy routes until verified cutover.

**Planning handoff:** Review the new design first. Then expand stage 0–1 into exact-file, test-first tasks using the Superpowers writing-plans process; plan remaining stages at each integration gate. No functional code changes are authorized by this roadmap.
