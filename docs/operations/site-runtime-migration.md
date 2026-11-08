# Per-site runtime migration

This procedure moves one existing CMS site from legacy CMS-backed public reads to the immutable artifact runtime. It is intentionally site-scoped and does not provide an all-sites switch.

## Inputs

-   the actual CMS site ID;
-   a stable UUID request key for the plan;
-   an authorized CMS administrator token in `CMS_ADMIN_TOKEN`;
-   `CMS_MIGRATION_API_BASE`, normally `https://cms.example/api/v4/presets`;
-   the site's verified public template record and current release/route tuple;
-   an isolated backup and restoration target prepared through `platform-backup-restore.md`.

Local testing may use a credential-free loopback HTTP API origin. All non-loopback communication must use HTTPS; the CLI never disables certificate validation.

## Plan

Create a staged operation and review its site-local impact:

```sh
node ops/migrate-site.mjs plan \
  --site "$CMS_SITE_ID" \
  --request-key "$MIGRATION_REQUEST_KEY"
```

The output contains the operation ID, source checksum and candidate page layout version. Planning converts legacy section configs into deterministic template layout nodes and sets the candidate runtime mode to `artifact`, but it does not modify the installed site, active release, route revision or `runtimeMode`.

Planning must stop with an error when any media, required field, page route, section or reference is invalid. Do not bypass a plan issue by deleting content or editing the database directly.

## Apply

Apply the reviewed operation:

```sh
node ops/migrate-site.mjs apply \
  --site "$CMS_SITE_ID" \
  --operation "$MIGRATION_OPERATION_ID"
```

The CLI reads the operation's reviewed source checksum, rechecks it, obtains the same-site mutation lease, publishes the complete candidate through Gateway, verifies the exact active release and route revision, then atomically switches the site to its candidate namespace and `runtimeMode: artifact`.

Normal edits for that site return `409 Conflict` while the operation is publishing. Keep the operation blocked during an unknown Gateway result; run the same apply request again so recovery can reconcile the durable phases. A different operation must not take over the publishing owner.

## Runtime configuration

An artifact deployment sets:

```sh
NUXT_SITE_RUNTIME_MODE=artifact
NUXT_RUNTIME_ARTIFACT_ROOT=/var/lib/gateway/artifacts
NUXT_RUNTIME_RELEASE_ID=<active-release-id>
```

An artifact site with no readable, matching, checksum-valid release returns an explicit unavailable error. It never falls back to CMS if `NUXT_LEGACY_CMS_PUBLIC_READ=true`.

A site that deliberately remains on the legacy path must specify:

```sh
NUXT_SITE_RUNTIME_MODE=legacy
NUXT_LEGACY_CMS_PUBLIC_READ=true
```

Missing site mode retains compatibility for an older deployment. The compatibility path must be removed only site by site after the artifact route is verified.

## Verify before expanding

1. Confirm the Gateway active `releaseId`, image/artifact identity and route revision match the migration operation.
2. Probe the site's home, representative image, sitemap and redirect through strict HTTPS.
3. Stop CMS and Gateway control in an isolated fixture and confirm pages, images, sitemap and redirects still come from the immutable artifact.
4. Remove one artifact file in the fixture and confirm an explicit fail-closed response with no CMS fallback.
5. Confirm another legacy site and an unrelated artifact site remain unchanged and editable.
6. Run one ordinary content update and publish it after the migration; prove that daily content changes do not require reinstalling the template.

## Rollback

```sh
node ops/migrate-site.mjs rollback \
  --site "$CMS_SITE_ID" \
  --operation "$MIGRATION_OPERATION_ID"
```

Rollback first asks Gateway to restore the exact previous release and route revision. Only after both match does CMS restore the previous complete installation and its prior runtime mode. Candidate Entries, media and operation snapshots are retained so old pages and media remain readable and diagnostics are not lost.

If a later draft exists, the migration operation stores a private complete draft snapshot before restoring the previous site; it must not silently discard those edits.

## Stop conditions

-   source checksum changed after planning;
-   operation belongs to another site/workspace;
-   candidate media is missing or belongs to another site;
-   Gateway returns an unknown or mismatched active tuple;
-   a second operation attempts to take the publishing owner;
-   the site changes through a path not covered by the mutation lock;
-   the artifact release checksum, host or identity is invalid;
-   the runtime would fall back to CMS;
-   rollback cannot prove the exact previous release and route revision.

Production rollout starts with one backed-up site. Additional sites are changed deliberately; there is no bulk switch.
