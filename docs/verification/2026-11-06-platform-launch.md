# Platform launch verification

Date: 2026-11-07 (Asia/Shanghai)

Scope: local implementation and evidence-gap verification for Task D2. This document is not a production `AcceptanceEvidence` record and does not authorize or claim a production deployment.

## Version identity

| Repository | Recorded source                                      | Production artifact identity                                                 |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| CMS        | `2d6c7b4471d511c94e76734f7275318908ec2531` (D2 base) | Image digest blocked                                                         |
| Gateway    | `c5389615772977db5cd1131d3fc312f8b56d1b47`           | Image digest blocked                                                         |
| Templates  | `2f4c35f37f5f33d8d7c9b922c37d7dc4501d4a32`           | `aero1.0.4`/`fireguard1.0.1` public image and Preview bundle digests blocked |
| Preview    | `5ee66507a9da81e262b72e06f213be4a2b34fe42`           | Image/bundle digest blocked                                                  |

Lock checksum: **blocked** because no valid complete `docs/releases/platform-lock.json` exists. No placeholder digest is used.

The local F2 source-only completion `b36e9ef415ae4ca5ad3a528350c5c83f` is retained as supporting recovery evidence only. Its `evidenceType` is `source-only-local`; it cannot satisfy production backup readiness. F3 monitoring evidence is also explicitly `source-only-local-monitor-drill`.

## Local probe verification

Command:

```sh
node --test ops/e2e/public-probes.test.mjs
```

Result: 9 passed, 0 failed, 0 skipped.

The tests prove:

-   HTTP 200 with old homepage content fails with `marker_missing`;
-   only the configured release marker is accepted;
-   requests use manual redirects, normal TLS validation and no CMS authorization/cookie;
-   a challenge redirect is preserved and rejected;
-   a product 404 is reported as `product_not_found`;
-   an image served as `text/html` is rejected as `content_type_mismatch`;
-   a response body that stalls after headers is terminated as `timeout`;
-   untrusted TLS and connection failures are separated;
-   an origin containing credentials is rejected before fetching;
-   a real local HTTPS server validates with its explicit CA, while its untrusted certificate is rejected;
-   CLI JSON reports `passed:false` and exits nonzero for HTTP 200 with wrong content, and exits zero only for the matching page/image fixture.

Retained local logs:

-   `.superpowers/sdd/2026-11-06-platform-delivery-master/d2-public-probes-red.log`;
-   `.superpowers/sdd/2026-11-06-platform-delivery-master/d2-public-probes-green.log`.

The first RED was the expected missing-module failure. A later RED exposed an unref'ed timeout allowing stalled body tests to exit before the deadline; the final GREEN keeps the timer active until body consumption completes.

## Acceptance case status

| Case                                                        | Status  | Evidence or blocker                                                              |
| ----------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Local strict public probe matrix                            | passed  | `public-probes.test.mjs`, 9/9                                                    |
| Complete four-repository lock                               | blocked | Genuine public OCI and Preview bundle identities unavailable                     |
| D1 formal browser/API acceptance                            | blocked | Local D1 evidence: 2 blocked, 46 not-run; no formal AcceptanceEvidence           |
| Authorized production backup                                | blocked | Only source-only F2 drill exists; off-host copy and installed policy unperformed |
| Authorized production restore                               | blocked | Isolated source-only restore passed; production recovery sheet not approved      |
| Authorized alert recipient and delivery                     | blocked | F3 local receiver only; no external delivery evidence                            |
| Independent public domain and TLS                           | blocked | No authorized acceptance hostname or Internet DNS/TLS execution                  |
| Traffic/ingest/control/worker/templates/Preview/CMS rollout | not-run | Production change is not authorized                                              |
| Acceptance-site content and performance checks              | not-run | Depends on authorized production deployment                                      |
| Second update and public rollback                           | not-run | Depends on actual Gateway active state                                           |
| Non-production inquiry and analytics                        | not-run | Depends on authorized intake and acceptance site                                 |
| Desktop/mobile, SEO and image probes                        | not-run | Local implementation exists; production origin absent                            |
| Real user create-site timeline                              | blocked | Requires a non-developer participant and authorized environment                  |
| Trial readiness decision                                    | blocked | Failed, blocked or not-run mandatory cases remain                                |

No production `AcceptanceEvidence` object is emitted. The future object must use the checksum of the valid complete lock and include actual production artifacts for every case.

## Human and external timing

No human 10-minute UAT was performed. Automation duration is not a human timeline and is not substituted here.

External DNS wait, authorized operator response time, external alert delivery and production incident handling remain unmeasured. The next authorized run must record them separately from application and build time.

## Remaining gates

-   Finalize genuine public template images, Preview bundle identities and complete PlatformLock through the reviewed publication process.
-   Execute every D1 mandatory case on that exact lock with zero failed, blocked or not-run cases.
-   Create and independently copy a `platform-lock-bound` F2 backup, then restore and compare it at an independent target.
-   Authorize an alert receiver and retain a successful external delivery.
-   Approve an independent acceptance domain, DNS/TLS ownership and a reversible cutover plan.
-   Execute the runbook in order, update one acceptance site and verify update plus rollback.
-   Have a real non-developer participant perform the complete create-site flow and record the timeline.
-   Only after all mandatory evidence passes may the platform be described as trial-ready or production-accepted.
