# PPT-Ops data contract

PPT-Ops separates upgradeable application files from private user and project data. Files are the durable source of truth; an index or runtime database must be rebuildable from them.

## Ownership manifests

The System Layer may be changed by an application update:

- `.agents/skills/ppt-agent/`, `src/`, `schemas/`, `test/`
- `templates/system/`, `docs/system/`, `.github/`
- `package.json` and `package-lock.json`

The User Layer must never be included in the system update set:

- `config/profile.yml` and `config/custom.md`
- `templates/user/`
- the resolved Data Root and every project, source, asset, version, build, review, handoff, and archive below it

The Project Layer is one relative child of the Data Root. Project identifiers and write targets must be relative, contained paths. Absolute project paths, `..` segments, path escape, and System/User overlap are contract errors.

## Data Root resolution

Resolution is independent of the current nested working directory. The repository is discovered by walking upward to the `ppt-ops` package, then exactly one source wins:

1. explicit invocation root, such as `--root`, for this execution only;
2. `PPT_OPS_ROOT`;
3. the single path stored in the repository-root `.ppt-ops-data` marker;
4. repository default `projects/`.

Relative roots are resolved from the repository root. An absolute Data Root is permitted because private data may intentionally live outside the application checkout; containment is enforced beneath that resolved root. Resolution never writes a permanent preference.

## Configuration precedence

Configuration is merged from broad reusable defaults toward the current request:

1. `profile` — identity, brand facts, fonts, and non-negotiable boundaries;
2. `custom` — reusable workflow and output preferences;
3. `project` — audience, purpose, source, theme, and project constraints;
4. invocation — temporary overrides for this execution.

Later layers override earlier layers. Nested objects merge by key; arrays and scalar values replace the earlier value. None of these layers may move a project write outside its resolved project root.

## Update invariant

An updater must validate every proposed target against the System manifest before writing. A target is rejected when it is outside the System manifest or overlaps any User manifest entry. This keeps private templates, profiles, and project data out of an application update even when Data Root configuration changes.
