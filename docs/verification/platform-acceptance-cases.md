# Platform acceptance cases

Run `node ops/e2e/test.mjs launch` from CMS. This command always writes `launch-result.json` with the exact 48 mandatory IDs and exits nonzero unless every result passes and the browser exits successfully. Missing results are `not-run`; duplicates, unknown IDs and invalid states are rejected. A blocked prerequisite is never a pass.

## Required identities and environment

The template identities are `aeroframe@1.0.4` and `fireguard@1.0.1`. Supply `E2E_PLATFORM_LOCK`, all four managed source roots (`E2E_GATEWAY_ROOT`, `E2E_TEMPLATES_ROOT`, `E2E_PREVIEW_ROOT`; CMS is the script's root), a new `E2E_RUNTIME_DIR`, and private `STOREFRONT_E2E_CMS`, `STOREFRONT_E2E_EMAIL`, `STOREFRONT_E2E_PASSWORD` environment variables for a fresh isolated runtime. Sources must be clean and match the lock. Lock format validation alone does not prove public artifact authenticity. The actual catalog must match source commit, manifest, image and preview digests; public publication observation must match the immutable release and active revision.

The runner starts at authenticated workspace/site creation, selects the exact template in the UI, and records the stable creation request key. The legacy seeded bootstrap rejects launch mode; other legacy callers must explicitly set `E2E_LEGACY_SEEDED_FIXTURE=1`.

## Exact case set

Each row is independently required for both `aeroframe/` and `fireguard/` prefixes. Auxiliary checks never create more mandatory IDs.

| Case                     | Required assertion / evidence                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE                   | UI workspace and wizard creation; exact catalog identity; stable request key; automatic provisioning ready                                                                         |
| CONTENT                  | Brand, headline and price persisted through the one ContentWorkspace                                                                                                               |
| MEDIA                    | Actual upload through media picker, selected reference saved and retained after reload                                                                                             |
| NAVIGATION               | Added page nested under named navigation group and persisted                                                                                                                       |
| PAGE                     | UI blueprint creation, actual POST success, clean saved state and canonical page data                                                                                              |
| SEO                      | Saved page SEO metadata                                                                                                                                                            |
| PREVIEW_DESKTOP          | Actual renderer visible at 1440×900                                                                                                                                                |
| PREVIEW_MOBILE           | Actual renderer visible at 390×844 using the canvas tab                                                                                                                            |
| SINGLE_EDITOR            | Exactly one ContentWorkspace for the canonical entry                                                                                                                               |
| LEGACY_EDITOR_LINKS      | Historical entry URL resolves to the same workspace                                                                                                                                |
| STRUCTURED_CONTENT       | Rich marks/lists survive save and reload; complete B6 array/widget/link coverage remains separately required                                                                       |
| LIVE_UNSAVED_PREVIEW     | Latest unsaved text appears within 1 second, without content write/publish requests                                                                                                |
| PREVIEW_RACE             | Delayed real preview response cannot replace newer input; service error is recoverable; full language/site retirement remains separately required                                  |
| PARTIAL_SAVE             | Content success plus page409 shows partial save; retry does not repeat content write                                                                                               |
| EDIT_CONFLICT            | Two actual editor pages produce409 and explicit local/version reconciliation                                                                                                       |
| TEMPLATE_LAYOUT          | Structured layout request rejected for template-only page                                                                                                                          |
| PUBLISH                  | UI publish, authoritative ready operation and immutable observation, public body marker and no foreign marker                                                                      |
| UPDATE                   | New release/revision, changed price and corresponding public content; price-specific public assertion remains required                                                             |
| ROLLBACK                 | UI rollback to original immutable release with new active revision and original content                                                                                            |
| FAILURE_PRESERVES_ACTIVE | Real unhealthy candidate plus stopped CMS/control/worker/ingest retain active identities and complete public response bytes                                                        |
| DOMAINS                  | Automatically provisioned default domain readiness; owned local fixture additionally exercises actual TLS challenge, primary switch, redirects and failed certificate preservation |
| ISOLATION                | Cross-site content, media and operations access denied; all three are required                                                                                                     |
| LEADS                    | Actual ingest, selected-site search, assignment/status, authenticated downloaded CSV bytes and foreign/nonexistent update denial                                                   |
| ANALYTICS                | Actual duplicated event yields one view, ready dashboard,503 cannot show zero, retry recovers                                                                                      |

## Current execution boundary

D1's local supporting command is `E2E_LAUNCH_LOCAL=1 node ops/e2e/test.mjs launch`, with `E2E_DATABASE_ENV_FILE` pointing at the already-owned database runtime env file and the managed repository roots above. It creates fresh owned Mongo/Postgres databases, compiles the current CMS UI, exercises two separately UI-created builtin `aeroframe@1.0.0` sites, uses the existing C4 local worker/image fixture and actual ingest handlers, and restores/stops only its own resources in `finally`. Docker and the existing local source image are prerequisites. Its two site labels do not substitute the required two template versions.

The local worker fixture's direct snapshot/TemplatePin path is supplementary and cannot prove the complete CMS public-record publication path. Local DNS and a private CA do not prove public DNS/ACME. Local fallback preview is explicitly distinguished from an exact Preview artifact. Local lead/analytics and fault evidence is not promoted into formal case passes. Formal fault/operations orchestration and complete isolation/language-race/B6 breadth remain not-run until connected and executed against the genuine fixed artifact combination; the runner cannot declare D1 complete on this basis.

At the time of the D1 execution the catalog exposed aero1.0.1–1.0.3 and fireguard1.0.0, while required aero1.0.4/fireguard1.0.1 plus a genuine complete lock were absent. The report records those exact CREATE cases as blocked and all dependent missing results as not-run. A missing or invalid lock produces `blocked-launch-not-AcceptanceEvidence` with `lockChecksum:null`, not a fabricated AcceptanceEvidence.

## Evidence security and review

Private login state is0600 inside a0700 directory and is removed after use. Native traces, HAR and video are disabled because they retain credentials. Browser evidence is a fixed-schema interaction timeline and masked screenshots. A deliberate authenticated publication-read guard violation must still retain those safe diagnostics, remove listeners, fail closed and expose no canary, credential or JWT. These timelines are not replay traces.

Retain each run's source checksums, exact commands, results, cleanup audit and failures. Review the latest frozen-source run separately from exploratory failed attempts. Production/manual novice timing and production approval belong to D2/F, not this command.
