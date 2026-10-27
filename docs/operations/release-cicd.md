# CMS release delivery

The `master` branch is the trunk and runs verification only. A release branch named `release/vMAJOR.MINOR.PATCH`, such as `release/v1.0.0`, runs the same checks and then publishes and deploys the CMS image. Pull requests targeting `master` and manual workflow runs verify the code without deploying.

The workflow builds the image with the source commit and release version in its OCI labels, pushes immutable commit-qualified tags, creates and verifies GitHub provenance, then asks the server deployer to activate the published image digest. Repository variables `DEPLOY_HOST` and `DEPLOY_USER` and production environment secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` are configured for deployment. The production environment permits release branches. The workflow uses `GITHUB_TOKEN` for GHCR access and the server's temporary image pull.

The server keeps a protected copy of the previous Compose configuration and restores it if the new application fails health or public-page checks. This application rollback does not reverse database migrations. The CMS service shares a network namespace with its proxy sidecar, so deployment recreates that sidecar along with the CMS container.

Gateway follows the same master and release branch policy. Templates also publish a new immutable registry record and synchronize the image to the server, but leave the active site on its current template version. Upgrade the template in CMS and publish the site to activate a new version.

Deployment receipts are stored under `/opt/novaintelligent/deploy/releases/` as `<component>.current.json` and `<component>-<run-number>.json`. The server serializes deployments, rejects stale workflow runs, and uses a separate forced-command SSH key for each component.

To release, update master, create the next `release/vMAJOR.MINOR.PATCH` branch from that commit, and push the branch. Watch the release branch's Actions run through verification, publication and deployment. A manual workflow run only verifies; rerun the original failed push run to retry delivery of the same commit.
