# Progress

- 2026-10-27: Public reuse approved by user. All three repos already public. GitHub CLI installed from official release; device authentication pending.
- Worktrees: CMS native managed worktree plus sibling Git worktrees for templates/Gateway; original checkouts preserved.
- Baseline: CMS backend typecheck passed; template tests and Gateway install in progress.

## Preflight ownership/interface check

| Pair/task | Contract | Result |
|---|---|---|
| Templates / CMS | registry schema, presentation and source commit | Shared spec freezes exact fields and hash format |
| Templates / Gateway | registry record and GHCR repository@digest | Shared spec freezes exact fields and source |
| CMS / Gateway | PUT pin, GET site revision, POST operations, GET operation status | Shared spec defines owner authorization and stable retry identity |
| Template task | code + tests + actual anonymous publication | Local tests cannot substitute remote publication |
| Gateway task | migration + compatibility + authorized status/pull | Legacy local mode preserved |
| CMS task | stored normalized manifest and version-specific explicit adoption | New version cannot silently replace edits |
| Deployment task | existing validation host, no production-readiness claim | Requires backups and actual repeated publication checks |

Decision: Keep public templates on Git + GHCR, as already documented. Do not introduce another registry service on the shared server.
Decision: Restrict first rollout to existing AeroFrame-compatible schema and one explicitly bound Gateway site. This reduces scope; general template schemas and site provisioning need subsequent work.
