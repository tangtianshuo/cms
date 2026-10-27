# Progress — 2026-10-27

All four implementation-plan tasks completed for the explicitly scoped single-site rollout. Full evidence: [verification](2026-10-27-public-template-roundtrip-verification.md).

- Public AeroFrame 1.0.1 released at `cad64f1`; GitHub workflow 40436497040 succeeded twice, immutable replay confirmed. Public manifest and GHCR digest anonymously verified on the deployment host.
- Reviewed Gateway `efc9509` and CMS `ae32553` deployed to the existing Nova Compose project after same-host backup and additive migration. Existing root service remains healthy.
- Browser adoption preserved all existing models, field mappings, pages, theme and content.
- Browser content edit and publication reached ready at revision 2; a controlled failed candidate at revision 3 preserved the previous active release and byte-identical served HTML; restoring content and republishing reached ready at revision 4.
- Final same-request replay returned the same operation/release. All four published page paths returned HTTPS 200. Original content restored apart from save timestamps.
- Final Gateway suite: 133 pass, zero skips. Final CMS suite: 65 pass, one existing local integration skip; UI tests 3 pass, typecheck/build passed. Real server API/browser acceptance supplements the local CMS skip.
- Source changes remain on `codex/public-template-flow`; default branches were not merged. No credentials are included in these documents.

The accepted scope is a single-site public validation rollout. Off-host backup/restore drills, capacity/alerts, general multi-site/domain provisioning, Gateway rollback UI and container lifecycle work remain. Draft preview is not deployed. This is not full production acceptance.
