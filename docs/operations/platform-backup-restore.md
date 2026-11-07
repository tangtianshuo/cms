# Platform backup and isolated recovery

This procedure captures MongoDB, PostgreSQL, immutable release artifacts, uploaded media,
complete current/previous/unresolved route snapshots, reserved-domain state, and the exact
PlatformLock bytes at one controlled maintenance point. A CMS-only backup is insufficient.
The initial RPO target is 24 hours; the RTO target is 60 minutes. Measure both on each drill.
A failed command or failed writer resume leaves an incomplete directory without a completion
manifest. Do not count such a directory as a successful backup.

## Supported deployment and prerequisites

The native adapter supports a single Docker daemon with Compose-managed CMS, control,
worker and ingest services, and existing PostgreSQL and MongoDB containers with their
matching database tools installed. Node 22, Python 3.9+, Docker CLI, the built Gateway
worker and traffic packages must be available on the operator host. It does not install
schedules, copy data remotely, update dependencies, or stop database containers.

One owner must control each routing state directory. Stop any operator automation that
could create new writer containers during maintenance. `exclusiveWriters: true` is an
operator assertion that these services are **all** writers: CMS provisioning/recovery jobs,
control domain reservation and probes, worker publication leases/reconciliation/retirement,
domain snapshot projection/retries, ingest and any scheduled writer. Put scheduled writers
in `writers` as additional services. An undeclared service, absent declared service, another
SQL connection (even idle), a live worker/provisioning lease, active Mongo operation, changed
Mongo dbHash or publication/domain snapshot fails closed. Mongo credentials/network ACLs
must exclude undeclared clients; a connection inventory cannot prove that an outside client
will never connect later. The adapter must not be used where exclusive writer ownership
cannot be established. The Mongo admin currentOp/listDatabases privileges are required;
permission failures are failures, not proof of quiescence.

Keep traffic, runtime containers, Preview and databases running. Runtime containers created
by the worker have `gateway.site-id` labels rather than Compose service labels; only named
Compose writer IDs are stopped. Protected Compose container identities/running state are
checked again before completion. Prefer dedicated database credentials and keep them in
an injected process environment. Never put URLs with passwords in configuration, argv,
manifest, reports or shell history. Mongo tools receive a unique private `/tmp` config over
stdin inside the configured database container and remove it in `finally`.

A genuine F1-approved full PlatformLock and publicly retrievable pinned renderer artifacts
are required for formal acceptance. `platform-lock-bound` means the backup is byte-bound
to a format-valid full lock; it does not replace F1 artifact authenticity/acceptance evidence.
The full lock must cover every active template version/digest, including an older active
version when the site's editable pin has moved ahead. Retain prior release artifacts too.

## Private configuration and maintenance response

Create a private operator JSON (0700 parent, 0600 file). Example values must be adapted to
the actual installation; they are not auto-discovered production targets:

```json
{
  "lock": "/srv/platform/platform-lock.json",
  "gatewayRoot": "/srv/gateway",
  "supervisor": {
    "project": "platform",
    "exclusiveWriters": true,
    "protectRuntimeContainers": true,
    "maintenanceFile": "/srv/platform/maintenance/content-maintenance",
    "maintenanceProbes": ["https://admin.example.test/api/maintenance-probe", "https://control.example.test/api/maintenance-probe", "https://intake.example.test/api/maintenance-probe"],
    "publicProbes": ["https://shop.example.test/"],
    "writers": {
      "cms": ["cms", "provisioning"],
      "control": ["control", "domain-probes"],
      "worker": ["worker", "reconciliation", "domain-retry"],
      "ingest": ["ingest"]
    },
    "protected": {"traffic":"traffic", "preview":"preview", "postgres":"database", "mongo":"database"}
  },
  "databases": {
    "postgresContainer":"platform-postgres-1", "postgresDatabase":"gateway",
    "mongoContainer":"platform-mongo-1", "mongoDatabase":"cms",
    "quiescenceTimeout":190
  },
  "paths": {
    "artifacts":"/srv/platform/artifacts", "uploads":"/srv/cms/uploads",
    "routes.json":"/srv/platform/routes.json", "domains.json":"/srv/platform/domains.json"
  }
}
```

Mount the maintenance directory read-only into the edge for the CMS/control/intake virtual
hosts. Configure the following in those existing locations, not in the storefront or
Preview virtual host. Configuration review/reload is a separate deployment operation.
The backup command checks the configured endpoints actually return 503 while public
probes return 200; a marker without working edge wiring cannot authorize the backup.

```nginx
# Inside CMS/control/intake locations; container path matches the mounted marker.
if (-f /run/platform-maintenance/content-maintenance) { return 503; }
error_page 503 = @content_maintenance;
# In the same server block:
location @content_maintenance {
    default_type application/json;
    add_header Retry-After 60 always;
    return 503 '{"error":"Content maintenance and inquiries temporarily unavailable"}';
}
```

Inject `PLATFORM_BACKUP_CONFIG`, `PLATFORM_PG_USER`, `PLATFORM_PG_PASSWORD`, and
`PLATFORM_MONGO_URI` from the secret manager. The Mongo URI must use `authSource` explicitly
if authentication is against a different database; the adapter selects the data DB itself.
Run from CMS:

```sh
umask 077
python3 ops/backup/platform_backup.py --output /srv/backups/platform/2026-11-07T030000Z
```

The output directory must not exist or be inside any captured source directory. The
originally running writer container set is captured before any stop, then restored in
`finally`; a service already stopped remains stopped. New leases are not granted during
the capture. Expired/deferred operations remain durable; backups do not delete or complete
them to manufacture quiescence. Credentials and route tokens remain private.

## Isolated restore

Do not start writers or traffic against the new directory until `restore-private.json`
says `ready`. Inject the same database container credentials and a `DATABASE_URL` pointing
to the supported PostgreSQL server. Also set `DOCKER_SOCKET_PATH`,
`GATEWAY_CONTROL_URL` (a valid new isolated control address), and explicitly set
`NUXT_PUBLIC_INGEST_ORIGIN` to the isolated intake origin. It uses the normal candidate
validation: an exact HTTPS origin or loopback HTTP origin, without credentials or paths.
An explicitly empty value disables intake; omission is rejected. Use a task-owned loopback
intake for local drills. The existing `gateway-sites` network is required. This command generates fresh
random `platform_restore_<24 hex>` PostgreSQL/Mongo databases and a private new directory:

```sh
python3 ops/restore/platform_restore.py --backup /srv/backups/platform/2026-11-07T030000Z --target isolated --directory /srv/drills/2026-11-07
```

The restore assigns a fresh `runtimeScope` in the private receipt and a singleton
`public."GatewayRuntimeScope"` database marker, replacing any marker copied from an earlier
recovery. Reconstructed containers carry only `gateway.restore.site-id`,
`gateway.restore.release-id`, and `gateway.runtime-scope` ownership labels, with no ordinary
`gateway.site-id` or `gateway.release-id` labels. Thus even an older ordinary collector cannot
enumerate recovery containers on the same daemon. Scoped worker creation, route inspection,
listing and retirement reinspection all require the matching scope. Each collector still
retires its own unprotected containers; active/previous routes and pending candidates remain
protected. This boundary is enforced by label validation and the persisted database marker.

Restore validates every file, exact file inventory, size, SHA256, lock checksum and paths
before mutation. It rejects absolute paths, traversal, symlinks, non-regular files, duplicate
paths, missing files, unlisted files and any existing destination. SHA256 detects corruption;
protect the manifest/lock authenticity through trusted private backup storage.

All database content is restored, including source workspace/site bindings, immutable
`defaultDomainId`, request keys, provisioning jobs, Domain/DomainChange (including
`retryAfter`), publications and prior release artifacts. Dead SQL lease owners/candidate
credentials and Mongo provisioning lease tokens are fenced; durable intent/attempt history
is retained. Snapshot paths are rebound to the new artifact directory with checksum checks.
The reconstructor starts fresh containers from each authoritative active release, its saved
renderer digest and immutable artifact. `/healthz` and a real representative-Host `/` must
succeed. SQL records a new Deployment identity and credential hash, while release and route
revision stay unchanged.

`saved-routes.json` retains the integrity-checked complete original current/previous and
unresolved snapshots as a **private recovery archive**. It is never the serving route path.
`routes.json` initially contains only newly reconstructed authoritative active routes, with
fresh IDs/ports/tokens and no old physical previous entries. Logical previous releases and
artifacts remain in SQL for real worker rollback. Pending domain retries resume normally
against the fresh active runtime. Never rename the archive to the serving path. Later
publications produce normal current/previous live route history. The standalone traffic
backup restore helper also refuses a newer destination revision, including one hidden in
its previous array; use it only under the single-owner/offline rule.

Start an isolated CMS with `DB_URL` targeting the receipt's Mongo database and its working
media directory at `<restore>/uploads`; start control/worker with the new SQL URL and
`SNAPSHOT_STORAGE_PATH`/`GATEWAY_SNAPSHOT_HOST_DIR=<restore>/artifacts`. Set
`GATEWAY_ROUTE_STATE_PATH=<restore>/routes.json` and domain state path beside it. On the worker,
set `GATEWAY_RUNTIME_SCOPE` to exactly the receipt's `runtimeScope` and preserve the explicit
`NUXT_PUBLIC_INGEST_ORIGIN` used for reconstruction. Missing/mismatched scope rejects startup
before router mutation, Docker inspection or collection. The marker survives database
renaming; a restored database name without a marker also fails closed. Never remove the
marker to run an ordinary worker on restored data. The native CLI passes the new scope to
reconstruction automatically; a manually invoked reconstructor also requires it. Use new
listeners/ports and explicit isolated host resolution. Preserve the CMS instance identity
and secret references used by restored source bindings. Do not automatically repoint
production DNS or ports. Compare actual home/product/image bytes, redirects and sitemap;
then publish a change and roll back to a pre-backup prior release.

On failure, receipts identify exact owned DBs and reconstruction container IDs. A SQL commit
followed by route-file failure leaves the owned resources/pending route file for inspection
rather than deleting potentially committed deployments. The `.reconstruction-owner` marker
prevents blind concurrent reruns. Investigate, or discard only these isolated resources and
retry into a fresh directory. `--target production` is deliberately refused: production
promotion requires an explicit reviewed recovery run sheet naming target identities,
maintenance owners, F1 lock/evidence, rollback artifact and cutover/abort criteria.

## Daily retention and independent copy

The default operating policy is one daily backup, keeping the latest 7 daily restore points
and 4 weekly restore points (the newest verified backup in each of the latest 4 ISO weeks).
A scheduler should invoke the backup command daily at 03:00 UTC with a unique UTC timestamp.
Do not install it during a development drill. This concrete retention selection lists local
candidates; delete only reviewed completed directories after an independent copy verifies:

```python
import json
from pathlib import Path
from datetime import datetime
from ops.backup.manifest import verify_backup
root = Path('/srv/backups/platform')
backups = []
for directory in root.iterdir():
    if directory.is_symlink() or not (directory / 'manifest.json').is_file():
        continue
    manifest = json.loads((directory / 'manifest.json').read_text())
    verify_backup(directory, manifest)
    backups.append((datetime.fromisoformat(manifest['createdAt'].replace('Z', '+00:00')), directory))
backups.sort(reverse=True)
keep = {directory for _, directory in backups[:7]}
weeks = {}
for date, directory in backups:
    weeks.setdefault(date.isocalendar()[:2], directory)
keep.update(list(weeks.values())[:4])
for _, directory in backups:
    if directory not in keep:
        print(directory)  # Review before shutil.rmtree(directory); never follow symlinks.
```

Once authorized, an off-host copy can use the following command with a dedicated restricted
backup account; no remote copy is performed by the scripts or this task:

```sh
rsync -a --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= /srv/backups/platform/2026-11-07T030000Z/ backup-host:/srv/backups/platform/2026-11-07T030000Z/
```

On the other host, run `verify_backup(Path(BACKUP), json.loads(...manifest.json...))` with the
same CMS source, then the isolated restore command above. A copied directory or successful
transfer alone is not readable-recovery evidence. Before production trial operations, retain
at least one successful off-host **or independent-directory** full drill, timings, public
availability samples, content comparison, republish/rollback, source identities and cleanup.

## Repeatable local drill and evidence limits

The source-only drill uses disposable databases on already-running owned test PostgreSQL
and Mongo, isolated CMS/worker processes, real production handlers, real Docker runtimes and
private files. It never pauses/restores shared DB servers. Supply managed checkout roots,
the private test credential file, a current-source renderer image (revision label must match)
and a new private output directory, then run:

```sh
E2E_F2_MODE=local E2E_C4_IMAGE=local/f2-aeroframe:source \
E2E_GATEWAY_ROOT=/managed/gateway E2E_TEMPLATES_ROOT=/managed/templates \
E2E_DATABASE_ENV_FILE=/private/runtime.env E2E_RUNTIME_DIR=/private/new-drill \
node ops/e2e/disaster-recovery.mjs
```

It checks page availability through maintenance, both native database tools, corruption
rejection (unit suite), independent directory/DB recovery, complete source bindings and
lease fencing, archived unresolved snapshots, domain retry convergence, old-release
rollback, actual bytes/Host checks and task-owned cleanup. The source worker and its
active/previous/candidate containers remain live while recovery publication and rollback run.
Both collectors must preserve the other scope across multiple cycles and then retire their
own disposable candidate garbage. A restored contact-enabled form and the actual container
intake environment are checked against a local task-owned intake origin. The process-fixture supervisor is
explicitly local; the production CLI uses the concrete Compose supervisor. Local identity
bytes are labeled `source-only-local`, never forged into a formal PlatformLock. The normal
restore CLI rejects them. Internet wildcard DNS/TLS, public OCI identities, off-host copy,
production scheduling and production cutover remain separately unverified/unperformed.

```sh
python3 -m unittest discover -s ops/test -p 'test_platform_*.py' -v
# Gateway checkout:
npm run build --workspace @gateway/traffic
npm run build --workspace @gateway/worker
node --test packages/worker/dist/restore-deployments.test.js
```
