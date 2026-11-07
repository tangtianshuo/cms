# Platform production launch and rollback runbook

This runbook describes a future authorized production acceptance deployment. Creating or reviewing the runbook does not authorize production switching, DNS changes, external notification delivery or human user-acceptance testing. The current workspace has no valid complete PlatformLock and therefore has not generated a production `AcceptanceEvidence` record.

## Current candidate identities

The source identities below are evidence inputs, not a production lock. The image-producing CMS commit, image and Preview bundle digests must be replaced with values read from the finalized lock and registry before any deployment.

| Component | Current recorded source                              | Production identity                                                                    |
| --------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| CMS       | `2d6c7b4471d511c94e76734f7275318908ec2531` (D2 base) | Exact image-digest-producing source commit and CMS image digest: **BLOCKED**           |
| Gateway   | `c5389615772977db5cd1131d3fc312f8b56d1b47`           | Exact control/traffic/ingest/worker image digest: **BLOCKED**                          |
| Templates | `2f4c35f37f5f33d8d7c9b922c37d7dc4501d4a32`           | AeroFrame `1.0.4` and FireGuard `1.0.1` public image and artifact digests: **BLOCKED** |
| Preview   | `5ee66507a9da81e262b72e06f213be4a2b34fe42`           | Preview bundle and image digest: **BLOCKED**                                           |

The complete `docs/releases/platform-lock.json` and its checksum are absent. Do not construct them from these source rows. F1 must generate and verify them from genuine registry artifacts first.

## Required inputs and current gaps

| Input                    | Required record                                                                                 | Current status                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Change approval          | Named operator, maintenance window, acceptance-site owner and abort authority                   | **BLOCKED**                                                                                        |
| Source and artifact lock | Four exact source identities, one complete lock checksum, all image/bundle digests              | **BLOCKED**                                                                                        |
| D1 acceptance            | Current-run evidence for every mandatory case; zero failed, blocked or not-run cases            | **BLOCKED** (local run: 2 blocked, 46 not-run)                                                     |
| Backup                   | Successful `platform-lock-bound` F2 completion ID and independently verified off-host copy      | **BLOCKED**; local source-only drill `b36e9ef415ae4ca5ad3a528350c5c83f` is not production evidence |
| Restore                  | Restore target, verified recovered content, RPO/RTO and rollback run receipt                    | **BLOCKED**; only source-only local recovery exists                                                |
| Monitoring               | Authorized recipient/channel plus latest successful external delivery                           | **BLOCKED**; F3 used a task-owned local receiver                                                   |
| Domain and TLS           | Independent acceptance hostname, strict DNS/TLS verification and approved certificate ownership | **BLOCKED**                                                                                        |
| Capacity                 | Database, artifact, media and container headroom approved by the operator                       | **BLOCKED**                                                                                        |
| Human UAT                | Real non-developer user timeline from create-wizard entry through default-domain acceptance     | **BLOCKED**                                                                                        |

Do not repoint a commercially used domain to a test site. Use an independently owned acceptance hostname unless the domain owner records explicit approval and a reversible cutover/rollback plan.

## Abort conditions

Stop before changing the active route when any of these occurs:

-   lock checksum, source commit, image digest, artifact digest or registry provenance differs from the approved deployment sheet;
-   PostgreSQL or MongoDB migration cannot complete through the approved additive order;
-   backup has no completion manifest, fails integrity verification, is source-only in production mode, or has not been restored and read at an independent target;
-   traffic, current runtime, Preview or required database health changes unexpectedly;
-   an undeclared database writer or active lease cannot be excluded;
-   the acceptance origin does not validate TLS normally or the D2 probe reports a challenge, wrong marker, wrong release, missing asset, product 404 or wrong content type;
-   monitoring cannot authenticate to publication state, has no authorized delivery path, or reports an unresolved delivery failure;
-   rollback artifact, previous authoritative release/route revision or rollback owner is unavailable.

After the active route changes, any failed content or ingestion gate means stop expanding to other sites and roll back the acceptance site first. Do not erase already applied additive database columns or run automatic destructive down-migrations.

## Deployment sequence

1. Freeze the change. Record the four clean source heads, complete lock checksum, deployment-sheet checksum, current active `releaseId` and `routeRevision`, previous rollback tuple and monitoring state. Confirm the operator and acceptance hostname.
2. Verify the lock and every artifact locally:

    ```sh
    node ops/release/platform-lock.mjs verify /secure/platform-lock.json
    sha256sum /secure/platform-lock.json
    ```

    The checksum displayed here must be the same lock checksum embedded in D1, F1, F2 and D2 evidence.

3. Create and independently verify a production backup using `docs/operations/platform-backup-restore.md`. Record the completed `backupId`, creation time, lock checksum, retained private location and a restore test that reached real page, product, image, redirect and sitemap content. A successful command without a completion manifest is not a backup.
4. Start the public monitor once against the current site. Record wrong-release, public-unavailable, control-unavailable, missing-asset, certificate, backup-age and publication-failure results. If the alert channel is not configured and authorized, stop before the production change.
5. Apply Gateway PostgreSQL migrations in lexical order with `prisma migrate deploy`. Current accepted migrations end with `20261107000000_domain_lifecycle` and `20261107010000_domain_retry`. Any later migration must be additive and reviewed with this runbook. Do not reverse existing columns when rolling back code.
6. Deploy immutable Gateway traffic, ingest, control and worker images in that order. Traffic and existing runtime containers must remain available while control and worker are replaced. After each service starts, verify health, scoped authentication, PostgreSQL/Mongo connectivity and the absence of route regressions.
7. Publish and verify the locked template artifacts, then deploy the matching Preview bundle. Confirm manifest, renderer and bundle identities against the same lock before registration.
8. Deploy CMS from the exact image digest in the lock. Do not rebuild during production deployment. Confirm it reads persisted source/site bindings, points at the intended Gateway, and does not fall back to local publication.
9. Update exactly one acceptance site. Confirm Gateway reports the expected active release and route revision before enabling additional sites. Keep the previous immutable release and route revision available.
10. Run the D2 public probe against the independently owned acceptance domain:

    ```sh
    node ops/e2e/public-probes.mjs \
      --origin https://acceptance.example \
      --marker 'replace-with-current-release-marker' \
      --path / \
      --path /products/acceptance-product \
      --path /images/acceptance-product.png \
      --path /sitemap.xml
    ```

    Replace the example domain, marker and product paths with the signed deployment sheet values. Output is JSON; every probe must have `ok: true` and exit status must be zero.

11. Verify page, navigation, product, contact form, SEO metadata and image content; submit a non-production inquiry through the authorized intake path; confirm the event/lead appears without recording message content in public evidence.
12. Perform one ordinary content update and publish it. Verify the new immutable release, then roll back to the recorded previous release. Confirm the old public content and the new draft/release history remain intact.
13. Run an actual non-developer user through the create wizard. Record per-step elapsed time, help requests, errors and external DNS wait separately. This is blocked until a real participant and independent acceptance domain are authorized; developer timing cannot replace it.
14. Only after all mandatory cases are passed and there are no blocked or not-run cases may the operator mark the environment trial-ready. Archive one production `AcceptanceEvidence` document whose `lockChecksum` matches every retained probe, browser, backup and deployment record.

## Rollback sequence

Use the fastest reversible layer first:

1. If the acceptance site's new release is unhealthy or renders the wrong content, call the existing Gateway rollback for that one site and verify the recorded previous `releaseId` and `routeRevision`.
2. If the new worker/control code is the cause, keep the old active runtime and redeploy the previous immutable Gateway images. Do not remove additive database columns.
3. If traffic routing is the cause, restore the reviewed previous route snapshot only under one-owner/offline control and verify that no newer destination revision is overwritten.
4. If CMS is the cause, redeploy the previous immutable CMS image and verify persisted bindings and the current Gateway active tuple.
5. If templates or Preview are the cause, switch the site back to the previous accepted release and bundle; preserve new immutable artifacts for diagnosis.
6. If data or media integrity is in doubt, stop only the affected writers and follow the reviewed F2 recovery procedure. Production restore is not the normal rollback path and must not auto-promote. Restore to an isolated target first where operationally possible, compare content and identities, then follow an explicitly approved production recovery sheet.

Record every attempted step, command result, active tuple, public probe result, alert delivery and unresolved artifact. A failed rollback keeps the environment closed to further site rollout and remains a blocking incident.

## Evidence record

For each production acceptance run, retain:

-   approval and deployment-sheet checksums;
-   all source, image, artifact and bundle identities from the complete lock;
-   D1, F1, F2 and F3 evidence with the same lock checksum;
-   backup/restore completion manifests, timestamps, measured RPO/RTO and independent copy verification;
-   every public probe result, certificate/domain identity and returned content type;
-   active/previous Gateway tuples before and after update and rollback;
-   monitoring delivery receipt and recipient/channel approval reference;
-   real human timeline and external DNS wait;
-   cleanup and incident results.

Do not place credentials, customer inquiry content, database dumps, route tokens or private keys in the repository.
