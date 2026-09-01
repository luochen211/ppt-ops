# ADR 0004: Provider-neutral AI candidates and privacy boundary

- Status: Accepted
- Date: 2026-09-02

## Decision

AI providers receive a task-specific allowlisted payload, never a serialized Project or Page object. Source text is excluded by default; a caller must explicitly authorize selected extracted segments. Request audit records contain policy, field paths, counts, and hashes, not raw private text or provider secrets.

Providers return a structured target ID and JSON Patch. Each task has fixed writable paths. Identity, contract metadata, unselected pages, and unsafe object-prototype paths cannot be patched. A response is parsed and validated before a `Candidate` reaches `ready_for_review`.

Candidates are persisted separately from Drafts. Only an explicitly accepted candidate whose base hash still matches the target Draft can be applied. Provider timeouts and transient HTTP failures may retry; malformed, out-of-scope, or target-mismatched responses never mutate Draft state.

The provider port is `generate(payload)`. V1 includes a configurable HTTPS JSON adapter; provider-specific SDKs may be added without moving policy or application rules into the adapter.

## Consequences

- Desensitization is enforced by payload construction and test inspection, not prompt wording.
- Local page regeneration has a measurable zero-change boundary for non-target pages.
- Acceptance and application remain user-controlled, even when a provider returns valid JSON.
- Provider response quality does not redefine the V1 Contract.
