# Fact provenance ledger

Use `fact-ledger.json` when a deck contains claims whose source, wording, or validity needs to remain auditable across revisions and audience variants. The ledger is optional; once present it is part of project truth and must travel with every Frozen Version.

Each claim has a stable id and revision, the exact statement plus its SHA-256 fingerprint, a claim kind and assertion status, explicit validity semantics, pinned source hashes with precise locators, and one or more JSON Pointer bindings to Page Spec fields. Never infer a validity deadline. Use `unknown` when none is established, and keep `conflicted` and `unable_to_verify` distinct from false.

`expired` and `review_due` mean that revalidation is due. They do not negate the statement. A source hash mismatch means the cited source changed after verification; inspect the new source before updating the claim or its snapshot.

Before changing a source or shared claim, run impact analysis and show every affected page and known audience artifact. Update a claim by advancing its revision; use `superseded_by` to preserve history rather than erasing an earlier assertion.

Review records the exact ledger revision, evaluation time, assertion states, validity states, source-integrity results, and configured policy. Findings are advisory unless an explicit project policy names blocking statuses. Handoff carries the same immutable Review evidence; it does not silently re-evaluate against mutable sources.
