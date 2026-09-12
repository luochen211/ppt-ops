# System updates

PPT-Ops uses GitHub Actions to test and package its System Layer. The root `update.mjs` checks, previews, applies, and rolls back updates. Requirements: Node.js 22 or newer, Git, npm, and tar; CI verifies Linux and macOS.

## Online update

```sh
node update.mjs check
node update.mjs preview
node update.mjs apply
node update.mjs rollback
```

Equivalent npm commands are `npm run update:check`, `update:agent-check`, `update:preview`, `update:apply`, and `update:rollback`. Commands work from another directory: `node /path/to/ppt-ops/update.mjs check`. Use `--root /path/to/installation` for another installation and `--data-root /path/to/projects` when needed. Otherwise data-root selection follows `PPT_OPS_ROOT`, `.ppt-ops-data`, then `projects/`.

Online updates use the latest successful main push run of `.github/workflows/ci.yml`, then fetch that exact commit from `luochen211/ppt-ops`. SHA selection and file hashes detect updates even if the package version has not changed. A newer pending or failed run is not selected. GitHub API errors stop the command; there is no fallback to an untested commit. An optional `GH_TOKEN` or `GITHUB_TOKEN` raises API rate limits; neither is needed for normal public access.

These are tested main builds. The separate GA release workflow still requires human and target-user acceptance evidence. No scheduled job changes a user's local installation.

## PPT Agent availability reminder

On its first invocation in a local Codex session, the PPT Agent runs `node update.mjs agent-check` separately from presentation commands. This read-only command reuses the ordinary tested-main `check` comparison, including file hashes that detect same-version changes, and caches a successful result for 24 hours in `.pptops-updates/agent-check.json`.

The JSON result has one of four statuses: `no-update`, `update-available`, `offline-or-degraded`, or `invalid-cache`. A fresh cached result has `cache: "fresh"`; a remote refresh has `cache: "refreshed"`. `node update.mjs agent-check --force` explicitly bypasses a fresh or invalid cache without applying anything. Cache contents are a small whitelist of versions, the tested commit, timestamp, and availability status; response headers, authorization values, raw command errors, and full change manifests are not stored.

Only `update-available` produces a conversational advisory. It names the tested commit and offers three choices: inspect with `preview`, apply after explicit user approval, or dismiss for the current session. Offline, GitHub API, invalid-cache, and unavailable-tool failures are non-blocking diagnostics; normal PPT Agent routing continues. The reminder is never appended to stdout from `pptops` or any existing JSON command, and it never runs `apply`, installs dependencies, creates a daemon, or schedules work.

## What changes

- Only tracked System Layer paths are distributed: `src/`, schemas, tests, the PPT Agent Skill, system templates/docs, workflows, scripts, updater, README, license, and package manifests.
- Projects, source materials, outputs, `acceptance/`, local references, profiles, and `templates/user/` stay local.
- Previously managed files deleted upstream are removed. Other local-only files are preserved.
- Local edits and path collisions are listed in `preview` and block `apply`. Symlinks in source or target paths and overlapping data roots are rejected before files are replaced.
- Major-version changes are rejected; use that release's migration instructions.

The first update requires a Git checkout. Its committed System Layer provides the baseline for detecting local edits. Subsequent updates use `.pptops-updates/installed.json`. The updater writes working-tree files; it does not reset Git, move HEAD, alter the index, create commits, or push. A developer who wants to incorporate local code changes should review and commit them before updating. A committed change to a managed file authorizes its replacement by the selected upstream snapshot, so preserve a branch or copy if that work must be kept.

## Apply and restore

`apply` takes an exclusive lock, installs incoming dependencies in a temporary directory with `npm ci --ignore-scripts`, and prepares a complete file backup before replacing anything. It retains the old dependency tree, swaps in the new one, and starts the updated installation's Doctor in a fresh Node process. If installation fails, the working installation is untouched; if Doctor fails, files and dependencies are restored.

Backups and metadata live in `.pptops-updates/backups/<id>/` and are ignored by Git. Keep this directory to retain rollback ability. `rollback` restores the last successful update's files and dependencies. Changes made after that update block rollback so they can be preserved first. A no-change apply does not replace the last backup.

An abrupt process kill or power loss is different from a caught failure. A remaining `.pptops-updates/lock/` blocks new writes. Check that no updater process is active before removing a stale lock. Preserve `.pptops-updates/` and inspect the newest backup's `manifest.json` and dependency folders before recovery; do not simply re-run apply over an interrupted transaction. Automatic rollback covers caught failures, while abrupt interruption may require restoring the prepared backup manually. User/project files are outside these backups and should have their own backups.

## Offline package

Download `ppt-ops-system-<commit>` from a successful CI run's artifacts, or obtain the system archive from a GA release. The artifact contains `ppt-ops-system.tar.gz` and `ppt-ops-system.tar.gz.sha256`.

```sh
# Run in the directory containing the two downloaded files.
shasum -a 256 -c ppt-ops-system.tar.gz.sha256
mkdir system-update
tar -xzf ppt-ops-system.tar.gz -C system-update
node /path/to/ppt-ops/update.mjs preview --source "$PWD/system-update"
node /path/to/ppt-ops/update.mjs apply --source "$PWD/system-update"
```

`--source` must point to the extracted System Layer archive, not a full GitHub source download. It must not contain `node_modules/`, project files, or user templates. Checksum verification is explicit for offline inputs; online fetching uses Git's exact commit identity. Offline here refers to the update source: installing dependencies may still need registry access unless they are in npm's local cache.

## CI and release artifacts

CI runs the full test suite, updater tests on Ubuntu and macOS, package checksum verification, and the extracted package's Doctor. It uploads system archives only after the required checks succeed. Artifacts expire after 30 days. Online updating fetches the tested Git commit, so it does not depend on artifact-download authentication or artifact retention.

The GA release workflow produces both the recoverable full source archive and the System Layer archive with their checksums. Its original acceptance gate is unchanged. CI and Doctor results establish automated checks; they do not establish human visual or native PowerPoint acceptance.
