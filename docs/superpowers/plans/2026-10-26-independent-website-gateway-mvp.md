# Independent Website Gateway MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-host Gateway MVP that accepts authenticated immutable Releases from CMS, persists publish intent, and safely deploys and routes approved per-site template containers with domain/TLS support.

**Architecture:** A Next.js App Router service exposes the CMS control API and stores durable state in PostgreSQL. A separate worker claims durable operations and alone accesses Docker to start/check site containers; Traefik is the public TLS ingress and routes only verified hostnames to active instances. Compose runs these services with separated networks, credentials, and Docker socket access limited to the worker.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL, Prisma, Vitest, Docker Compose, Traefik, ACME HTTP-01.

---

## File Map

- `apps/control`: Next.js CMS API, authentication, health endpoints, and service-level tests.
- `apps/worker`: durable operation polling, deployment orchestration, Docker adapter, and worker tests.
- `packages/contracts`: shared request/domain schemas and deterministic checksum helpers.
- `prisma/schema.prisma`, `prisma/migrations`: PostgreSQL durable state and migrations.
- `infra/traefik`: Traefik static/dynamic config and production-safe ACME persistence.
- `compose.yaml`, `compose.dev.yaml`, `Dockerfile*`: isolated service topology for Windows development and Linux production.
- `.env.example`, `.gitignore`, `package.json`, workspace config: reproducible local setup without secrets.

## Task 1: Workspace and service skeleton

**Files:** repository root config, `apps/control`, `apps/worker`, `packages/contracts`, tests.

- [ ] Initialize a TypeScript workspace with Next.js App Router in `apps/control`, worker package, shared contracts package, formatting/typecheck/test scripts, and pinned Node engine.
- [ ] Add a failing test for liveness and readiness semantics: liveness succeeds without DB; readiness fails when DB check fails and succeeds when it passes.
- [ ] Implement `/api/v1/health/live` and `/api/v1/health/ready` with no secret/config disclosure.
- [ ] Run lint, typecheck, tests, and production build; verify baseline works on Windows.

## Task 2: PostgreSQL model and CMS authentication

**Files:** `prisma/schema.prisma`, migration, auth module, API tests.

- [ ] Define Workspace, Site, TemplatePin, Release, Domain, PublishOperation, ActiveDeployment models with unique constraints for hostname, release identity, and operation idempotency.
- [ ] Add tests for missing/invalid service identity, workspace ownership derivation, and cross-workspace access denial.
- [ ] Implement server-only service credential authentication using constant-time secret comparison and derive workspace from authenticated principal; never trust body workspace IDs.
- [ ] Add migration, seed-free local startup, and PostgreSQL integration test configuration.

## Task 3: Release ingestion and immutable storage

**Files:** release route/service, checksum contract, persistent snapshot adapter, tests.

- [ ] Add tests for canonical JSON checksum, raw media checksum, first upload, identical retry, and conflicting reuse of `siteId + releaseId`.
- [ ] Implement bounded Release payload validation for site/workspace/template identity and `sha256:<hex>` immutable image digest against configured allowlist.
- [ ] Write snapshot bytes to a temporary path, verify checksum, atomically finalize, then record metadata in a DB transaction; clean incomplete temporary files after failure.
- [ ] Add authenticated upload/read APIs scoped by site and workspace; public routes cannot read drafts or incomplete snapshots.

## Task 4: Durable publish operations and worker isolation

**Files:** publish operation API/service, worker process, Docker adapter, tests.

- [ ] Add tests for idempotency key replay, expected active revision conflict, durable claim lease, and worker restart recovery.
- [ ] Implement operation creation and transactional desired-state recording in PostgreSQL; worker claims operations with a lease and records bounded safe failure reasons.
- [ ] Implement worker-only Docker adapter that accepts allowlisted immutable digests, fixed network/resource limits, generated container names, and site-scoped configuration; reject arbitrary image refs and Docker options.
- [ ] Ensure only worker Compose service mounts Docker socket; control API, Traefik, and site workload definitions do not.

## Task 5: Candidate deployment, readiness, switch, and rollback

**Files:** deployment coordinator, route configuration adapter, tests.

- [ ] Add integration tests proving failed readiness leaves the active tuple and route unchanged, while successful readiness updates `(siteId, imageDigest, releaseId, routeRevision)` exactly once.
- [ ] Start candidate with staged Release and site identity; probe readiness and representative Host before changing active deployment.
- [ ] Apply route revision atomically through Traefik-supported dynamic configuration; verify the new Host route before marking operation ready; restore previous route on failure.
- [ ] Retain previous container/release for a configured rollback window, implement explicit rollback through the same readiness gate, and clean expired inactive instances.

## Task 6: Domain ownership and ACME HTTP-01

**Files:** domain API/service, Traefik config, tests.

- [ ] Test hostname normalization (case, trailing dot, IDN), global uniqueness, pending state, and safe removal of the last active host.
- [ ] Implement domain reservation and DNS target/status reporting; do not route before HTTP-01 certificate readiness.
- [ ] Configure Traefik ACME HTTP-01, staging/production issuer settings, persistent certificate storage with restrictive permissions, and automated renewal.
- [ ] Document/encode that wildcard certificates are unsupported; verify multiple apex/subdomains and failed issuance leave existing active routes untouched.

## Task 7: Compose topology and end-to-end validation

**Files:** Compose files, Dockerfiles, infrastructure config, smoke tests.

- [ ] Add PostgreSQL, control API, worker, and Traefik services with separate internal/public networks, health dependencies, persistent DB/snapshot/certificate volumes, and non-secret `.env.example`.
- [ ] Verify only worker has Docker socket; avoid privileged mode; set CPU/memory limits and site workload egress restrictions supported by the chosen Compose/host topology.
- [ ] Add end-to-end smoke test with local test image for first publish, content-only publish, explicit template digest upgrade, failed upgrade preservation, rollback, and unknown Host rejection.
- [ ] Run Windows Docker Desktop smoke suite and Linux production Compose acceptance; record HTTP-01 staging, restart recovery, backup/restore, and route rollback results. Do not claim production readiness until Linux/public DNS drills pass.

## Completion Gates

- Every task uses test-first changes for behavior and passes its focused test before proceeding.
- Spec compliance and code-quality review occur at each independently completed task; unresolved Important issues block the next task.
- No commit, push, public repository change, production certificate request, or production traffic cutover without explicit authorization.
- Windows Docker success is development evidence only; Linux public DNS/ACME, backup/restore, resource isolation, and failure-recovery drills remain production gates.
