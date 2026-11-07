# Platform release delivery

The four repository release workflows produce candidates. CMS and Gateway no longer deploy from a release branch push. Templates retains its immutable OCI/Preview retry and registry availability transaction, including selected contract, rendering, resource and archive checks before availability, but no longer synchronizes the server. Preview publishes only its immutable commit tag; `latest` is not a deployment input. Candidate jobs retain their existing publication environment so current image build variables and publication approvals still apply; they no longer activate services. Candidate production must precede the complete PlatformLock, so public template availability is not circularly dependent on the full platform gate.

The CMS **Platform release gate** workflow is the sole automated production deployment entry. Its `platform-gate` job checks out all four complete locked Git commits, installs existing dependencies, builds the locked sources and both template runtimes, verifies signed candidate provenance and real OCI identities, and runs A4, D1 and the complete B3 subset. `deploy` explicitly needs `platform-gate`. No failure or skipped mandatory case can produce deployment outputs. The deployment job does not rebuild or resolve a tag; it verifies the current-run receipt hash/attestation and uses the exact digest, source SHA and version from that receipt.

## Inputs and identity

`workflow_dispatch.lock` is the unchanged schemaVersion 1 / contractVersion 1 PlatformLock. Its repository names must be `tangtianshuo/cms`, `tangtianshuo/Independent-Website-Gateway`, `tangtianshuo/Independent-Website-Templates`, and `tangtianshuo/Independent-Website-Preview`, each with a full commit. Required template versions are AeroFrame 1.0.4 and FireGuard 1.0.1. Each locked template retains its manifest checksum, image digest, Preview archive digest and bundle digest.

`workflow_dispatch.candidates` is a separate schemaVersion 1 manifest:

```json
{
  "schemaVersion": 1,
  "services": {
    "cms": {"image": "ghcr.io/tangtianshuo/cms@<actual sha256 digest>", "version": "<actual semver>"},
    "gateway": {"image": "ghcr.io/tangtianshuo/independent-website-gateway@<actual sha256 digest>", "version": "<actual semver>"},
    "preview": {"image": "ghcr.io/tangtianshuo/independent-website-preview@<actual sha256 digest>", "version": "<actual package version>"}
  },
  "templates": [
    {"id": "aeroframe", "version": "1.0.4", "image": "ghcr.io/tangtianshuo/independent-website-templates/aeroframe@<locked image digest>"},
    {"id": "fireguard", "version": "1.0.1", "image": "ghcr.io/tangtianshuo/independent-website-templates/fireguard@<locked image digest>"}
  ]
}
```

The placeholders above are not executable artifacts or release evidence. A candidate string alone never proves identity. The verifier runs `gh attestation verify` against the source repository, exact source commit and expected release workflow, pulls each immutable reference, and inspects actual RepoDigests, engine image ID and revision/version labels. An old reused image without matching signed provenance fails; do not create an attestation that claims a different source to make it pass. The A4 runtime uses these pulled image IDs as its expected build identities, preserving its service/template/active-image and successful-cleanup checks. Its local scope remains supporting evidence rather than public acceptance.

The resulting safe receipt contains raw lock/evidence/candidate checksums, the verification checksum, retained case artifact hashes, source identities and independently verified candidate images. It is attested by the platform workflow and uploaded by exact filename. Raw process logs, DB credentials, authentication states, keys and private runtime files are never uploaded. Preserve private diagnostics only in the isolated runner's controlled evidence storage; remove credentials after investigation. A new attempt uses fresh directories and cannot overwrite earlier evidence. CLI replay is rejected for gate windows older than six hours or claiming future execution.

## Owned acceptance and prerequisites

Use a dedicated disposable Linux runner labeled `platform-integration`, with Node 22, npm, Docker/Compose, Python 3, OpenSSL, `gh` supporting artifact attestations, and browser dependencies. Docker must permit the runner's owned site containers and loopback ports; ports 27029, 15432, 18080, 18090 and 18184 must be free. The runner's local PostgreSQL/Mongo pair is created by A4, migrated, shared with D1 through private generated credentials, and removed in the finalizer. No preexisting database credential file is required.

The `platform-integration` GitHub environment requires:

- `PLATFORM_FORMAL_ARTIFACTS`: absolute runner-local path to D1's genuine archive/record JSON, using exact public records and actual archive files. This is the existing D1 interface, not a fixture identity.
- `PLATFORM_DOMAIN`: an authorized isolated wildcard domain whose DNS and public address policy reach this runner. It covers the actual created site hosts plus reserved `cms.<domain>` and `preview.<domain>` hosts. All must reach the owned TLS listener on port 443.
- Secrets `PLATFORM_TLS_CERT_PATH` and `PLATFORM_TLS_KEY_PATH`: private runner-local paths to the real trusted wildcard certificate/key. Certificate verification is never disabled. The runner needs permission to bind 443; no DNS or certificate acquisition is performed by the gate.

B3 is executed inside D1 before its teardown, not against a caller-selected remote CMS. The F1-only HTTPS forwarding map routes just the reserved CMS/Preview hosts to D1's actual owned loopback services; every other host follows the normal Gateway traffic path. CMS HTML and built JavaScript/CSS are fetched over the real public HTTPS origin and hashed against the newly built locked-source UI. Preview serves the verified installed archive and every manifest-listed asset is checked against its bytes. D1 browser site IDs and current SQL ActiveDeployment rows supply B3's exact site, release, revision and unique run marker. Public site responses must equal the owned runtime's responses. No external matrix file or claimed service provenance is accepted.

B3 executes all 28 template/viewport cells and retains its `B3-subset-only` label. F1 composes these with D1's exact 48 mandatory IDs; `overallB3Complete:false` is not a substitute for the matrix and is not an automatic failure of a complete D1 composition. Missing, failed, blocked or not-run cells/cases, wrong schema/environment, foreign run/source/site, dirty files, stale checksums, failed browser exit, incomplete cleanup or mismatched artifacts all block the gate. Complete real prerequisites can run the formal path; local fixtures cannot satisfy it.

Equivalent local invocation, after installing/building the same locked sources and configuring the prerequisites above:

```sh
export E2E_GATEWAY_ROOT=/absolute/isolated/gateway
export E2E_TEMPLATES_ROOT=/absolute/isolated/templates
export E2E_PREVIEW_ROOT=/absolute/isolated/preview
export E2E_GATE_DIR=/absolute/private/fresh-platform-run
export E2E_RUNTIME_DIR="$E2E_GATE_DIR/a4"
export E2E_PLATFORM_LOCK=/absolute/private/platform-lock.json
export E2E_CANDIDATES=/absolute/private/platform-candidates.json
export E2E_FORMAL_ARTIFACTS=/absolute/private/formal-artifacts.json
export E2E_FORMAL_PLATFORM_DOMAIN=approved-isolated-domain.example
export E2E_FORMAL_TLS_CERT=/absolute/private/cert.pem
export E2E_FORMAL_TLS_KEY=/absolute/private/key.pem
export DOCKER_SOCKET_PATH=/var/run/docker.sock
node ops/e2e/test.mjs platform-gate
```

`node ops/release/verify-platform.mjs LOCK EVIDENCE` is the independent final verifier. It additionally requires the current `E2E_GATE_RUN_ID`, `E2E_GATE_STARTED_AT`, candidate manifest and four roots. EVIDENCE is D1's `acceptance-evidence.json`; sibling `platform-verification.json` must contain this run's real lifecycle/A4/owned-B3 reports. The orchestrator supplies this context automatically. A nonzero status prohibits deployment; a merely schema-valid evidence file is insufficient.

## Deployment and outstanding external validation

Create three CMS repository environments: `platform-production-cms`, `platform-production-gateway`, and `platform-production-templates`. Each carries the matching existing `DEPLOY_HOST`/`DEPLOY_USER` variables and forced-command `DEPLOY_SSH_KEY`/`DEPLOY_KNOWN_HOSTS` secrets; keys must retain their component restriction. Copying the same key into all environments is not appropriate. Keep existing production approval rules. Central workflow run numbers must be greater than the server's stored component receipt sequence before enabling delivery; prepare a reviewed sequence migration if previous repository workflow counters are greater. Do not reset server state automatically.

Set `deploy:false` for the test-branch verification run. With authorized real inputs, intentionally change one lock SHA and separately remove one mandatory result in a test fixture, retaining the failed `platform-gate` and skipped `deploy` job evidence. Restore exact inputs and run the valid path. Review the actual receipt, image identities, cleanup and job dependencies before enabling `deploy:true`. Do not modify real registry records to inject failures. Public publication, CI dispatch and production changes require separate authorization; none were performed during local F1 implementation.

Stable job/check names are `Platform release gate / resolve`, `Platform release gate / platform-gate`, and `Platform release gate / deploy (...)`. Preserve repository verification checks (`CMS CI and release / verify`, `Gateway release / verify`, `Template release / verify`, `Preview service / verify`) in their existing protection policies. Require successful central `platform-gate` for platform delivery and protect the platform workflow/environment. Its check is emitted in CMS only; do not configure a nonexistent cross-repository check name on the other repositories. Capture actual Actions check contexts, protection/ruleset responses and environment configuration after authorized setup. The exact emitted names and applied protection evidence remain externally unverified until that run.

Preview currently has no automated deploy client. Its same verified digest, matching bundle registry and receipt must be used by the existing approved manual Preview activation procedure; never resolve `latest`. CMS/Gateway deployment and AeroFrame synchronization preserve the existing deploy clients. Template synchronization does not replace any site's adopted version or content. Server rollback retains the previous Compose configuration and does not reverse database migrations.

Formal passing PlatformLock/AcceptanceEvidence, public DNS/TLS execution, CI failure/valid-path runs, branch-protection evidence and production activation are separate outstanding gates when their real prerequisites or authorization are unavailable. Unit valid-format fixtures and skipped live HTTP checks do not count as formal acceptance.

## First production delivery, 2026-10-27

All three GitHub default branches are `master`. The following push-triggered workflows completed successfully, including server delivery:

| Component | Release branch | Source commit | Actions run | Server result |
| --- | --- | --- | --- | --- |
| CMS | `release/v1.0.0` | `d2dd484cf98ca48ff604198e5c3898c71f0d8c0c` | `40461881844` | CMS and namespace proxy replaced; healthy |
| Gateway | `release/v1.0.0` | `e9854d2677ebffdd3ee6f388d28d2b3c86b9b687` | `40461546661` | Backup/migration and control/worker update completed |
| Templates | `release/v1.0.2` | `4f6e1a8d4558b610c395590537dc2891db109be6` | `40461390282` | Immutable registry record and server image synchronization completed |

The final server verification matched image revision/version labels, receipts and running CMS/Gateway images, checked the recreated CMS proxy namespace, and confirmed all five public pages returned HTTP 200. The active shop retained revision 4, its existing content release and AeroFrame 1.0.1 image. Exact digests, timestamps, workflow URLs and public-page results are recorded in [release-cicd-acceptance.json](release-cicd-acceptance.json).

The clean CMS runner exposed a required build order: run `npm run build:types` after installing backend dependencies and before UI type-check/build. This is now explicit in CI and the Dockerfile. The final Actions run verified the complete clean build and deployment.
