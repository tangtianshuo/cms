---
name: publish-platform
description: Audit CMS, Gateway, Templates, and Preview for unpublished changes, then push versioned release branches that trigger their GitHub Actions. Use when the user says 发布, publish, release, or asks to check updates for these platform repositories.
---

# Publish Platform

Use the repository-owned release coordinator; do not recreate its Git logic by hand.

Run from the CMS repository:

```sh
node ops/release/publish.mjs [projects] [options]
```

## Interpret the request

-   “发布” with no project names means all four projects. Let the script inspect all of them and publish only those with updates.
-   “发布 CMS / Gateway / Template / Preview” means only the named projects. Pass only those names to the script.
-   “检查更新”, “预演”, or “只检查” means a planning run. Do not pass `--execute`.
-   A direct publish request authorizes `--execute`: the script creates and pushes release branches, and the branch push triggers the existing GitHub Actions workflows.
-   Use patch versions by default. Pass `--bump minor` or `--bump major` only when requested. `--version X.Y.Z` is allowed only for one selected project.

Examples:

```sh
# Publish every project that has updates
node ops/release/publish.mjs --execute

# Publish only Gateway and Templates
node ops/release/publish.mjs gateway template --execute

# Inspect only CMS without pushing
node ops/release/publish.mjs cms
```

## Required behavior

-   Do not manually create release branches, push them, or dispatch workflows after the script succeeds.
-   Treat `blocked` as a stop condition for that project. Report the reason; do not bypass dirty-worktree, synchronization, or branch-collision checks.
-   Do not create duplicate branches. `already-published` means the selected branch already points at the current default-branch commit.
-   For Templates, keep the release branch version equal to the selected template version in `release-target.json`. The script creates the next immutable template directory and version metadata when the selected version is already released.
-   Continue processing the other selected projects if one is blocked, then report every result and any Actions links.

The script owns update detection, semver selection, release branch creation, and branch-push triggering. Production activation remains a separate Platform Gate step.
