# Versioned branch delivery implementation plan

> **For agentic workers:** use the dispatching-parallel-agents skill for independent repository workflows and requesting-code-review for the integrated review.

**Goal:** master trunk and release/vMAJOR.MINOR.PATCH delivery for CMS, Gateway and Templates.
**Architecture:** independent GitHub-hosted builds publish GHCR digests and call the shared forced-command server deployment contract.
**Tech Stack:** GitHub Actions, Docker/Compose, SSH, Python 3, Node 22.
**Spec:** docs/superpowers/specs/2026-10-27-release-cicd-design.md

## Global constraints

- Server: 101.33.78.203; Compose project nova-cms-validation at /opt/novaintelligent/deploy.
- Repo images: ghcr.io/tangtianshuo/cms, ghcr.io/tangtianshuo/independent-website-gateway, ghcr.io/tangtianshuo/independent-website-templates/aeroframe.
- SSH command: deploy sha256:DIGEST COMMIT VERSION RUN_NUMBER. Fixed component comes from the authorized key forced command. GITHUB_TOKEN is passed only over stdin, never in argv.
- Shared workflow client .github/scripts/deploy.sh consumes IMAGE_DIGEST, RELEASE_VERSION, DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, GH_TOKEN, GITHUB_SHA and GITHUB_RUN_NUMBER.
- Templates synchronize image only, never replace the active site.

## Tasks

- [x] Task 1: create master defaults for Gateway/Templates; preserve historical branches and verify remote default metadata.
- [x] Task 2: shared release metadata, SSH client and tested server deployment state machine. Tests cover strict input validation, rollback, stale run rejection, template sync without Compose mutation, and sidecar recreation. Run python3 -m unittest discover -s ops/test -v, bash -n .github/scripts/deploy.sh and workflow validation.
- [x] Task 3: CMS CI/test/build/publish/provenance/deploy workflow, deterministic Docker install and source labels; run existing backend/UI tests and builds.
- [x] Task 4: Gateway CI using isolated PostgreSQL 18, migrations/tests/types/build; package the existing known runtime Dockerfile with source labels.
- [x] Task 5: generalized template release metadata, a new immutable 1.0.2 source, version-aware workflow and registry publication followed by server image synchronization. Verify template tests/validators/build/image smoke.
- [x] Task 6: integrated independent code review, install root-owned deployer and constrained SSH keys, configure repository secrets and variables without exposing credentials.
- [ ] Task 7: merge verified changes to master, create version release branches, observe actual GitHub runs and repair real failures. Verify deployed image/source identity, service health, preserved content and default branches; save run URLs and operational instructions.

## Progress

Tasks 1–6 complete. Reused public-template-flow worktrees on codex/release-cicd. Gateway/Templates defaults are master. Constrained component SSH keys, production environments and root-owned deployer are configured. Independent review found no Critical/Important issues. Validation: CMS Mongo-enabled backend 99 pass, UI 9 pass/1 skip; Gateway 133 pass and image smoke; Templates root 30 pass, storefront 7 pass, build/image smoke; shared deployer/metadata 10 pass; all three workflows pass actionlint. CMS local Docker build was blocked before application build by Debian/Docker Hub network errors; real Actions validation is still required. Task 7 in progress.
