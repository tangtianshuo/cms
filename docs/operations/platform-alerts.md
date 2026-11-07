# Public availability and operational alerts

The monitor checks public sites independently from the publication control plane. A public page can remain healthy while control is unavailable; control failure is reported under its own alert key. A page that returns HTTP 200 for the wrong release, marker or asset also fails.

## Inputs and thresholds

The JSON file in `ops/monitoring/config.example.json` is a format template. Replace its example domains, release identity, template identity and marker with values from the accepted F1 lock and D2 deployment run sheet. Secrets stay in the process environment named by `tokenEnv`; they do not belong in the JSON, state file, command line or alert payload.

Each site's `expectedTemplate` must match an entry in the F1 lock carried by the verified F2 completion. A missing or changed template identity produces `locked-target-mismatch`; the public marker and control release identity are checked in addition to this lock binding.

The monitor emits:

- `release-mismatch` when an HTTP 200 page lacks the configured release-bound marker or returns a conflicting release header;
- `public-unavailable` immediately for non-success non-5xx responses, or after three consecutive 5xx/no-response samples;
- `control-unavailable` when the authenticated authoritative publication-state request is unavailable;
- `locked-target-mismatch` when the site's expected template is absent from the verified lock;
- `missing-assets` when a configured representative asset is not HTTP 200 with the expected content type;
- `certificate-expiring` when fewer than 14 days remain before normal TLS validation expires;
- `backup-stale` when the latest valid completion manifest is over 26 hours old;
- `backup-unverified` when the completion manifest, files, lock checksum or required evidence scope cannot be verified;
- `publish-failures` when the authoritative Gateway operation count is at least three failures in 15 minutes;
- `slow-response` when latency exceeds 3 seconds for three consecutive samples.

Public requests use manual redirects, strict certificate validation, a 10-second bounded timeout and no CMS authorization or cookie. Management requests read only publication state and the 15-minute failure count. They never select a deployment or change a release.

## Backup evidence

The monitor runs the existing F2 Python verifier against the completion directory. Age comes from `manifest.json.createdAt`, never directory timestamps. An interrupted or corrupt capture is rejected.

`source-only-local` can be accepted in the `local` drill scope while remaining visibly limited to local evidence. `production` requires `platform-lock-bound`; a source-only capture produces `backup-unverified`. The runbook still verifies the separate off-host copy and installed retention schedule outside this monitor.

## Durable state and delivery

`statePath` stores active alert episodes, pending notification work and bounded delivery history as a private `0600` file written by temporary-file rename. A one-shot run lock prevents overlapping executions; a lock whose owner is no longer alive or is over three minutes old is reclaimed after abrupt termination. Malformed state fails closed rather than resetting dedupe history.

The first condition enqueues one alert. A successful delivery records `lastNotifiedAt`; the same key is suppressed for 15 minutes and can then produce at most one reminder. Clearing the condition enqueues one recovery. Receiver failures update a separate retry task with bounded exponential-free retry timing from `notification.retryMs`, up to eight attempts. Delivery failure does not change public traffic or suppress recovery.

Every delivery carries an `Idempotency-Key` equal to the durable notification ID. The receiver should use it to deduplicate a retry after an ambiguous network failure. Alert bodies contain only site ID, alert key, severity, message and timestamps; inquiry content and credentials are absent.

If no notification destination is configured, the JSON reports `monitoring-unconfigured`. A remaining local receiver exercises delivery in the development drill; this is not proof that an external operator channel exists. D2 must record the authorized recipient/channel and latest successful external delivery separately.

## Publication observation

`GET /api/v1/sites/:siteId/publication-state` keeps its existing active release, route revision, snapshot and artifact identity. It now also returns:

```json
{
  "observability": {
    "publishFailureCount15m": 0,
    "windowMinutes": 15
  }
}
```

The count is a read-only aggregate over failed `PublishOperation` rows in the last 15 minutes. It does not alter claim order, leases, C4 domain retries, active deployments or publication status.

## Scheduling

`platform-monitor.service` is a one-shot run and `platform-monitor.timer` schedules it every 60 seconds. Both files are reviewable artifacts only. Installation requires a dedicated unprivileged account, a private environment file, a read-only application/template/backup mount and a writable `/var/lib/platform-monitoring` directory.

Review and test before installation:

```sh
systemd-analyze verify ops/monitoring/platform-monitor.service ops/monitoring/platform-monitor.timer
```

Do not install or enable the timer until the target environment, authorized notification receiver, public domains, TLS trust, full lock and backup scope have been explicitly approved.

## Local drill

The F3 integration drill starts task-owned public, control and receiver HTTP servers, creates a disposable completion manifest and exercises wrong-content HTTP 200, site outage/recovery, asset 404, stale/invalid backup, test certificate expiry, control failure, duplicate state reload and receiver retry. It retains only generated fixtures and safe timestamps/status counts. It must clean its listeners and temporary state; shared PostgreSQL/MongoDB are not used by this drill.

The drill is source-only evidence. It does not claim Internet DNS/TLS, an authorized external channel, installed scheduling, production backup copy or production readiness.
