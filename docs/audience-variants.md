# Audience-specific deck variants

One project may serve several audiences without becoming several disconnected copies. `variants.json` records named audience outcomes, a stable base revision, an ordered subset of shared pages, and sparse page or section overrides.

Resolution is deterministic: select the declared shared pages, apply only that variant's overrides, renumber the effective deck, and derive its filtered Outline. The base and sibling variants are never mutated. Existing projects without `variants.json` resolve as one implicit `default` variant.

When shared Page Specs change, impact analysis reports affected inherited and overridden pages for every variant. A frozen variant with affected pages is stale evidence; it is not silently rewritten. The Agent must show the affected variants and create a reviewable Candidate or explicit rebase decision before adoption.

## Accepted variants and delivery

Use the Agent to name the audience, purpose, duration, delivery mode and selected pages. It saves a sparse definition against one existing frozen shared-base Version after recording the user's exact decision. The foundation operations remain available for read-only proposals; formal variant freezing requires a matching acceptance record.

The application interface is `variant-manage` with `list`, `save`, `resolve`, `impact`, `compare`, `rebase`, and `archive` actions. Mutation payloads include `actor: "user"` (or a supplied `user:<name>`), `raw_feedback`, and the `expected_revision` returned by `list`. A stale manifest revision fails without changing any variant. `save` takes a full sparse `variant`; the other scoped operations take `variant_id`, with `base_version_id` for impact/rebase and `other_variant_id` for comparison.

`version-freeze --variant <id>` resolves the selected definition from its pinned, hash-verified base. Its immutable snapshot retains the resolved pages and a variant record; the user project remains unchanged. Version metadata, Build configuration, Review, and both Handoff manifests carry the variant ID, base Version/hash, override hash and acceptance record. Reindex preserves these identities.

A shared correction starts with a new shared-base Version. `impact` reports affected pages, nested inherited/overridden fields, changed shared components and stale frozen outputs; `compare` shows page additions/removals and field differences even when two variants pin different bases. `rebase` records the explicit choice for one selected variant. Previously frozen outputs and sibling definitions remain unchanged. Archiving hides a definition from future builds without deleting any source, asset, evidence, or prior output.

The executive/workshop lifecycle regression builds both audience variants, corrects a shared fact, adopts it only in the executive version, verifies all older artifact hashes, and preserves provenance through Review, Handoff and reindex. Test acceptance is synthetic; it does not supply real business or PowerPoint acceptance.

A user-facing prompt should describe outcomes rather than inheritance internals:

> This project has a 5-minute executive version and a 45-minute workshop version. Should this change apply to both, or only to the workshop?
