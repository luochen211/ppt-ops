# ADR 0008: Rendered cross-page rhythm advisory

## Status

Accepted

## Context

Template IDs and written design decisions do not prove that adjacent slides
look different. Conversely, consistent composition can be intentional. PPT-Ops
therefore needs rendered evidence without turning a heuristic into an aesthetic
verdict.

## Decision

HTML QA collects browser-computed geometry from visible headings, text blocks,
structural elements, annotated QA regions, and media. The analyzer normalizes
that geometry to slide dimensions, buckets each coordinate at 5% of the slide,
and compares the resulting multisets. It reports an advisory finding when every
adjacent pair in a run of at least three slides has similarity of 0.82 or more.
Template IDs are not an input.

An image, video, or canvas with `data-asset-id` is dominant when its rendered
area is at least 12% of the slide. Reuse of the same dominant asset on two or
more adjacent slides is reported independently of layout repetition.

Findings contain page numbers, normalized signatures or asset rectangles,
pairwise similarity, the threshold, a reason, and the evidence source
`browser-computed-geometry`. The HTML QA result exposes the complete rhythm
analysis under `rhythm`; findings also appear in the existing combined finding
list. Rhythm warnings do not turn a structurally valid deck into a failed deck.

### Explicit exceptions

Deliberate continuity is local and auditable. Put an exception on only the
affected slide and always explain it:

```html
<section class="slide"
  data-qa-rhythm-exception="layout"
  data-qa-rhythm-reason="Three-step process preserves one frame while state changes">
```

`layout` suppresses only layout-run comparison through that page. To suppress
one repeated dominant asset, use `asset:<data-asset-id>`, for example
`asset:checkout-wireframe`. Multiple scopes may be space-separated. There is no
blanket `all` exception. Missing reasons and unsupported scopes remain visible
as advisory contract findings.

Thresholds may be overridden only through the programmatic analyzer options
for controlled fixtures or a deliberate integration. Values are bounded:

- layout similarity: greater than 0 and at most 1;
- minimum run: integer of at least 3;
- dominant asset area: greater than 0 and at most 1;
- geometry bucket: greater than 0 and at most 0.25.

## Acceptance boundary

This detector identifies measurable repetition risk. It does not decide that a
deck is monotonous, attractive, coherent, presentation-ready, or accepted by a
person. Named human visual acceptance remains a separate review record.

## Consequences

- Cross-page rhythm now has deterministic, page-addressable rendered evidence.
- Deliberate consistency is possible without weakening the global detector.
- Media without `data-asset-id` cannot make a stable repeated-asset claim and is
  intentionally excluded from that check.
- Browser geometry is not pixel-level perceptual similarity. That limitation is
  explicit rather than represented as human judgment.
