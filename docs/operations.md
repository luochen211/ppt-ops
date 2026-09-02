# Installation, Upgrade, Backup, Recovery, and Troubleshooting

## Install

Requirements: macOS for Microsoft PowerPoint evidence, Node.js 22, npm, Git, and Codex with repository Skill discovery enabled.

```sh
git clone https://github.com/luochen211/ppt-ops.git
cd ppt-ops
npm ci
npm test
node src/cli.js doctor
```

Open the repository in Codex and ask: `使用 $ppt-agent 把我的资料生成一份可编辑 PPTX`.

## Data and backup boundary

Back up the whole project directory before an update. Portable truth is the V1 JSON contracts, source files, immutable `.pptops/` manifests/snapshots/builds, and project assets. SQLite is a rebuildable local index, not the only truth.

Use a new timestamped backup destination outside the project. Confirm that the copy contains `project.json`, `sources.json`, `pages.json`, source files, and `.pptops/` before changing the installation. Never copy only the SQLite file.

## Upgrade

1. Keep the project backup unchanged.
2. Obtain the trusted release archive and verify its published SHA-256.
3. Run `update-preview` against the extracted release. Review every changed System Layer path.
4. Run `update-apply`. User and Project Layer paths are rejected before mutation.
5. Run `doctor` for each active project, then `npm test` in the installation.

```sh
node src/cli.js update-preview /path/to/current/repository --source /path/to/extracted/release
node src/cli.js update-apply /path/to/current/repository --source /path/to/extracted/release
node src/cli.js doctor /path/to/project
```

The updater creates a backup and rolls back if post-update Doctor fails. Do not manually merge release files into project data.

## Recovery

If SQLite is missing or corrupt but portable project truth is intact:

```sh
node src/cli.js reindex /path/to/project
node src/cli.js doctor /path/to/project
```

If an update fails, retain the updater report and backup. If project contracts or source files are damaged, restore the entire project backup to a new directory, run `doctor`, and compare hashes before replacing the damaged working copy.

## Troubleshooting

| Symptom | First check | Safe action |
|---|---|---|
| Project does not open | `doctor /path/to/project` | Fix the first required diagnostic; do not delete `.pptops/`. |
| Build is rejected with `BOUNDARY_IMAGE_REQUIRED` | Boundary role, PageSpec ID, and evidence code | Return to the named page's ImageGen brief/generation/observation/accept/register step; never edit provenance by hand. |
| Build is rejected for another reason | Structured error code and PageSpec ID | Correct the named contract, source reference, or capacity violation; create a new Version. |
| PowerPoint evidence is degraded | PowerPoint, `pdftoppm`, timeout, render lock | Close a hung dialog, confirm tools, and retry; increase `PPT_OPS_RENDER_TIMEOUT_MS` only for a known large deck. |
| Interrupted queue work | Attempt and event history | Reopen the store; recovery retains the failed attempt and requeues safe work. |
| Handoff is refused | Boundary image evidence and Review state | Restore the exact accepted image evidence or record the required review decision. Never edit the database to bypass either gate. |
| Update touches project/user data | Preview layer report | Stop. A valid System update must not own those paths. |

Never report `doctor`, CI, structural QA, or automated PowerPoint export as human acceptance.
