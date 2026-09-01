# ADR 0002: Local SQLite metadata and filesystem objects

- Status: Accepted
- Date: 2026-09-01

## Decision

PPT-Ops stores project indexes, entity revisions, build state, attempts, and ordered job events in a project-independent SQLite database. It stores immutable version snapshots and build artifacts under each registered project root. SQLite does not contain source files or artifact BLOBs.

The implementation uses Node.js `node:sqlite` on the Node 22 runtime baseline, enables foreign keys and WAL, and applies numbered idempotent migrations when the store opens. The local API binds to loopback only.

Versions and handoffs are append-only. Build input identity (`project_id`, `version_id`, targets, config) does not change after enqueue. Retry adds a new attempt while retaining failed attempt evidence. On restart, an interrupted active attempt is marked failed and its build returns to `queued` with a recovery event.

## Consequences

- A process restart does not lose queue state or failure evidence.
- Large files remain inspectable and portable in the project directory.
- Future database replacement requires a new ADR and migration.
- API callers receive IDs and project-relative artifact paths rather than stable absolute-path identifiers.
