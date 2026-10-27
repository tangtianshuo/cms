# CMS release delivery

The `master` branch is the trunk and runs verification only. A release branch named `release/vMAJOR.MINOR.PATCH`, such as `release/v1.0.0`, runs the same checks and then publishes and deploys the CMS image. Pull requests targeting `master` and manual workflow runs verify the code without deploying.

The workflow builds the image with the source commit and release version in its OCI labels, pushes immutable commit-qualified tags, creates and verifies GitHub provenance, then asks the server deployer to activate the published image digest. Repository variables `DEPLOY_HOST` and `DEPLOY_USER` and production environment secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` are configured for deployment. The production environment permits release branches. The workflow uses `GITHUB_TOKEN` for GHCR access and the server's temporary image pull.

The server keeps a protected copy of the previous Compose configuration and restores it if the new application fails health or public-page checks. This application rollback does not reverse database migrations. The CMS service shares a network namespace with its proxy sidecar, so deployment recreates that sidecar along with the CMS container.

Gateway follows the same master and release branch policy. Templates also publish a new immutable registry record and synchronize the image to the server, but leave the active site on its current template version. Upgrade the template in CMS and publish the site to activate a new version.

Deployment receipts are stored under `/opt/novaintelligent/deploy/releases/` as `<component>.current.json` and `<component>-<run-number>.json`. The server serializes deployments, rejects stale workflow runs, and uses a separate forced-command SSH key for each component.

To release, update master, create the next `release/vMAJOR.MINOR.PATCH` branch from that commit, and push the branch. Watch the release branch's Actions run through verification, publication and deployment. A manual workflow run only verifies; rerun the original failed push run to retry delivery of the same commit.

## First production delivery, 2026-10-27

All three GitHub default branches are `master`. The following push-triggered workflows completed successfully, including server delivery:

| Component | Release branch | Source commit | Actions run | Server result |
| --- | --- | --- | --- | --- |
| CMS | `release/v1.0.0` | `d2dd484cf98ca48ff604198e5c3898c71f0d8c0c` | `40461881844` | CMS and namespace proxy replaced; healthy |
| Gateway | `release/v1.0.0` | `e9854d2677ebffdd3ee6f388d28d2b3c86b9b687` | `40461546661` | Backup/migration and control/worker update completed |
| Templates | `release/v1.0.2` | `4f6e1a8d4558b610c395590537dc2891db109be6` | `40461390282` | Immutable registry record and server image synchronization completed |

The final server verification matched image revision/version labels, receipts and running CMS/Gateway images, checked the recreated CMS proxy namespace, and confirmed all five public pages returned HTTP 200. The active shop retained revision 4, its existing content release and AeroFrame 1.0.1 image. Exact digests, timestamps, workflow URLs and public-page results are recorded in [release-cicd-acceptance.json](release-cicd-acceptance.json).

The clean CMS runner exposed a required build order: run `npm run build:types` after installing backend dependencies and before UI type-check/build. This is now explicit in CI and the Dockerfile. The final Actions run verified the complete clean build and deployment.
