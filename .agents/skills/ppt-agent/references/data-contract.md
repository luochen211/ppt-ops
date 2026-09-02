# Project and Data Root resolution

Use the repository implementation in `src/config/data-contract.js`; do not invent another resolver.

Resolve the Data Root in this order: explicit invocation root, `PPT_OPS_ROOT`, repository `.ppt-ops-data`, repository `projects/`. A project name is a relative child of that root. Reject absolute project paths, `..`, escape, and System/User overlap.

When no project is named, use a project explicitly established in the current conversation only. If none exists, route to `new` for a new-deck request or `discovery` when intent is unclear. Never choose a project by scanning private directories or by guessing from unrelated history.
