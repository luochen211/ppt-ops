# Audience-specific deck variants

One project may serve several audiences without becoming several disconnected copies. `variants.json` records named audience outcomes, a stable base revision, an ordered subset of shared pages, and sparse page or section overrides.

Resolution is deterministic: select the declared shared pages, apply only that variant's overrides, renumber the effective deck, and derive its filtered Outline. The base and sibling variants are never mutated. Existing projects without `variants.json` resolve as one implicit `default` variant.

When shared Page Specs change, impact analysis reports affected inherited and overridden pages for every variant. A frozen variant with affected pages is stale evidence; it is not silently rewritten. The Agent must show the affected variants and create a reviewable Candidate or explicit rebase decision before adoption.

## First-phase boundary

This phase supplies the manifest schema and deterministic domain operations for validation, resolution, comparison, isolation, backward compatibility, and shared-change impact reporting. It does not yet wire variant identity into Version, Build, Review, or Handoff records, add CLI commands, support variant-only new pages, or provide the executive/workshop Golden Conversation workflows.

A user-facing prompt should describe outcomes rather than inheritance internals:

> This project has a 5-minute executive version and a 45-minute workshop version. Should this change apply to both, or only to the workshop?
