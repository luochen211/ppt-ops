# ADR 0007: HTML overlap quality gate

## Status

Accepted.

## Context

HTML slides can be within the viewport and still be visually broken. A connector may cross a text block, two nodes may occupy the same space, or a decorative layer may cover content. Width, height, overflow, and screenshot existence checks do not detect those failures. CSS pseudo-elements are also invisible to DOM element collision checks.

## Decision

PPT-Ops uses an explicit geometry contract for HTML slide elements:

- `data-qa-role="node"` protects a semantic shape or content container.
- `data-qa-role="content"` protects independent text or media content.
- `data-qa-role="connector"` identifies a line or arrow that must terminate at node boundaries.
- `data-qa-role="decorative"` excludes a non-semantic layer from collision checks.
- `data-qa-id` gives every checked element a stable evidence identifier.
- `data-qa-policy="strict"` on a slide makes removal of all annotations a failing coverage error.
- `data-qa-allow-overlap-with="id-a id-b"` records a narrow intentional-overlap exception.
- `data-qa-overlap="allow"` is reserved for elements whose complete overlap behavior is intentionally exempted.

The default policy is deny:

1. Connector-to-node and connector-to-content penetration is an error.
2. Content-to-content and node-to-node overlap above the configured ratio is an error.
3. Parent-child containment is allowed because the child belongs to the parent container.
4. Edge contact within one rendered pixel is allowed.
5. Protected elements outside the slide boundary are errors.
6. Intentional overlap must be declared in markup and appears in code review.

Connectors must be real DOM elements. A semantic connector may not be implemented only as `::before` or `::after`, because it cannot produce stable page-addressable QA evidence.

## Enforcement

`pptops html-qa <html-file>` launches a local headless Chrome/Chromium renderer at 1600x900, waits for the document and fonts, collects page-relative geometry, and emits JSON findings with page number, element identifiers, roles, intersection rectangle, overlap ratio, and reason.

The normal Review command includes this check when HTML QA is enabled. Repository CI also runs the command against the maintained HTML deck. A finding fails the gate; an unavailable browser is reported as degraded rather than misreported as a pass.

The standard HTML renderer marks every generated slide as strict and annotates its header, primary copy, asset region, and footer. A hand-authored deck may introduce annotations incrementally, but a deck with zero annotations is degraded and cannot pass the standalone gate.

Rendered automation, human visual acceptance, real PowerPoint acceptance, and business acceptance remain separate evidence.

## Consequences

- HTML authors must annotate semantic nodes and connectors that require protection.
- False-positive exceptions are local and auditable rather than hidden in detector code.
- Existing unannotated pages are not claimed as collision-checked; the report includes `annotated_page_count` and element counts.
- This gate detects axis-aligned geometry collisions. It does not replace screenshot inspection for contrast, visual balance, transparent pixels, or complex SVG path semantics.
