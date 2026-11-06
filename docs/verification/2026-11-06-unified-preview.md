# Unified preview — B3 verification scope

Date: 2026-11-07. Overall B3 remains **incomplete** until D1 supplies the complete
approved PlatformLock and real public publication prerequisites. Local browser,
installer and edge evidence is recorded in the task-B3 report under the assigned
master evidence directory. This document defines what the local checks prove.

The actual disposable CMS source/UI and Preview source serve freshly built
AeroFrame1.0.4 and FireGuard1.0.1 bundles installed through the real archive extractor
and bundle installer. Release bundles compiled for another CMS origin are kept
separate. Desktop1440×900 and mobile390×844 cover exact identity/digest, ready canvas,
navigation, unsaved updates, authorized HTTPS media bytes with decoded dimensions and
pixels, rich-text save/reload, template mode, and an isolated saved-snapshot template
runtime. The local saved runtime is separate from Gateway/publication acceptance.
Source inventories and installed artifact identities are retained per unique run.

The authenticated failure policy retains a masked screenshot and a fixed-schema JSON
interaction timeline. Real canaries in URL/header/auth/cookie/body/DOM/storage/console
must be absent from retained output. Native trace/HAR/video remain off. Invalid login
has no recording. Playwright remains pinned to1.65.0.

The CMS edge renderer is optional when preview is unconfigured (`frame-src 'self'`)
and fails closed when a configured service has no valid exact public origin. Both
nginx templates reject injected origins. The actual stock-nginx test checks startup
and returned CSP. The Preview TLS edge fixture uses approved unchanged B2 artifacts,
verifies real TLS against a throwaway certificate, and checks resolver identities,
HTML/cache/CSP and content-hashed bytes. It does not claim authoritative DNS or
production deployment.

`--foundation` is explicitly foundation-only. `--local` requires all feasible local
cells; PUBLISH remains blocked without actual release/public marker inputs. Formal
mode validates exact lock/source/registry identities and emits the B3 subset in the
master AcceptanceEvidence schema. Missing/blocked/not-run cells fail the formal gate.
The default entrypoint remains nonzero without formal inputs. No public rollout,
production write, notification, trust-store change or dependency upgrade is included.

Replay commands and lifecycle/cleanup requirements are in
`docs/operations/unified-template-preview.md`. Preserve initial failures and explicit
blocked/skipped counts in the report; source metadata is never relabeled as another
commit or release. Runtime private files and owned processes/databases are removed
on normal completion, with shared Mongo/PostgreSQL services left running.
