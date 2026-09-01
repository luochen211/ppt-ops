# ADR 0005: Deterministic semantic layout and independent renderers

- Status: Accepted
- Date: 2026-09-02

## Decision

V1 ships eight semantic template families: hero, statement, comparison, sequence, process, hierarchy, data, and cycle. A template declares supported relations, semantic slots, capacity, and separate HTML/PPTX mappings.

A deterministic Layout compiler resolves base Theme, project override, then page override; checks text and asset capacity; records geometry and asset fit; and emits a target-neutral Layout Plan. Over-capacity text fails with `LAYOUT_CAPACITY_EXCEEDED`. The system does not silently shrink text or split pages without producing a separately reviewable candidate.

HTML and PPTX consume the same Layout Plan but render independently. HTML remains a self-contained responsive presentation. PPTX uses native editable text and shapes. Pixel equality is not a goal; semantic content, page task, template identity, and capacity outcome must agree.

PDF and PNG are derivative targets: PDF is exported from a successfully reviewed native PPTX or browser surface with its source Build recorded; PNG is a per-slide derivative with page mapping. V1 does not make either derivative the source for HTML or PPTX.

## Consequences

- Identical Page Spec, Theme, template version, and build config produce a structurally stable plan.
- Theme overrides have one explicit precedence order.
- Renderer-specific geometry cannot rewrite shared copy or sources.
- Real browser screenshots and PowerPoint acceptance remain T8 evidence, not automated T6 claims.
