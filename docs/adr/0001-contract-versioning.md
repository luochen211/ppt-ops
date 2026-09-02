# ADR 0001: V1 contract identity and Foundation migration

- Status: Accepted; Foundation formal-build consequence superseded by ADR 0002
- Date: 2026-09-01

## Decision

Every V1 entity carries `contract_version: "1.0"`, a stable lowercase `id`, and a `kind`. Contract changes remain backward-compatible within 1.x when they only add optional fields. Removing, renaming, or changing the meaning of a field requires a new major contract version and an explicit migrator.

The former four-file CLI model is named `Foundation`, even when an early file used `schema_version: "1.0"`. It is never treated as the V1 entity contract because it has no `contract_version` and `kind` discriminator.

Foundation projects are read-only migration inputs. Migration writes a new destination, never edits the source, derives stable IDs and hashes deterministically, and records fields that cannot be inferred as warnings. New projects write only V1 entities. The current renderers receive an in-memory compatibility projection from V1; that projection is not persisted.

## Consequences

- UI, CLI, persistence, AI, and renderers can test the same entity boundary.
- An accepted candidate and an approved/frozen version remain distinct records.
- Existing Foundation projects remain readable and migratable. ADR 0002 supersedes the former transition-time formal-build compatibility.
- Cross-entity semantic checks remain necessary in addition to JSON Schema.
