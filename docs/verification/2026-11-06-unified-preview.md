# Unified preview — early B3 browser foundation

Date: 2026-11-06. Scope: early Step 1 fixture and renderer-unavailable baseline.
Overall B3 is **incomplete**. This document is local source/browser evidence;
it is not a PlatformLock or passing AcceptanceEvidence.

The validated product source base is CMS
`950e092faef52fa3455e28d118594db6bfd16487` (accepted B1) and actual local Preview
`f031349ad3a9b8632e7e180280039f4d14d7536b`. CMS runs current TypeScript and a fresh
current-source UI build, using a fresh owned Mongo database per run. No historical
A4 CMS image, published OCI artifact or final B2 registry/lock is substituted.
The baseline installation is actual built-in `aeroframe@1.0.0`; it does not count
toward the required AeroFrame1.0.4/FireGuard1.0.1 or final two-template matrix.

Validated with Playwright1.65.0 and Chromium1254:

- Real login through `/`, using actual accessible names, reaches 工作台 in desktop
  1440×900 and mobile390×844.
- The actual Preview source with an empty approved registry returns no renderer.
  The authenticated CMS descriptor is HTTP200, `Cache-Control:no-store`,
  `status:unavailable`, `configured:true`, exact installed identity and `runtime:null`.
  Both browser projects show “该模板版本尚未提供预览” as an alert and have no iframe.
- A real invalid-password browser login fails with a sanitized diagnostic and
  retains no screenshots/trace/HAR/video or injected credential text.
- A controlled authenticated product failure retains a screenshot masking account
  email and sensitive inputs, without raw DOM snapshots or network recordings.
  Retained text is checked for injected credentials and JWT-shaped tokens.
- The acceptance runner remains exit1 after a green foundation unless explicitly
  run with `--foundation`. Local success always reports `overallB3Complete:false`.

The early trace exception is explicit: the controller requires session tokens,
Authorization and cookies to be treated as credentials. Trace is off until a safe
retained trace strategy is implemented and verified. This is a deferred B3 criterion,
not a passed trace check. No unsaved draft assertion, live canvas, image/rich-text,
page switching, published-site equality, two-template ready-renderer matrix, formal
version lock, deployment/edge checks or production switch is claimed.

Replay and cleanup commands are in
`docs/operations/unified-template-preview.md` under “Early B3 browser foundation”.
Skipped environment-dependent tests must be recorded separately; run browser and
security checks through the disposable runtime to obtain actual browser results.
