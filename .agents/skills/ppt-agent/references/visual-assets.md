# Visual Asset Pipeline

Use generated raster assets only when a character, scene, conceptual diagram, or background does a page job that native PowerPoint text and shapes cannot do clearly enough. The page `visual_job` and three-second message come first; a style label such as low-poly is never the semantic request.

The first and final page are mandatory exceptions to the optional-use rule: each must contain at least one accepted ImageGen result registered through this pipeline. Determine them from canonical `pages.json` order. A one-page deck may use one accepted generated image for both roles. Static/imported images, screenshots, SVGs, native shapes, and hand-written provenance do not satisfy the boundary.

## Boundary page composition

The first and final page are image-led, not ordinary title slides with a decorative image. The accepted ImageGen visual must occupy the majority of the composed page and remain the primary reading cue. Visible slide copy is exactly one title. Remove subtitles, body copy, kickers, presenter labels, brand text, footers, page numbers, CTAs, and navigation text from the boundary-page canvas; do not retain them as compatibility fields or visually hidden alternate copy. The title may overlay a quiet part of the image or sit in a compact supporting region, but it must not divide the page into equal text/image columns.

Review the exact rendered page, not asset dimensions alone. Confirm that the visual is dominant, the title remains readable, important image content is not cropped, and no secondary text survives in HTML or PPTX.

## Controlled workflow

1. Create a minimal Visual Asset Brief for one named page and slot. Declare subject count, action, prohibited interpretation, identity boundary, composition, ratio, text policy, transparency, copy-safe space, and avoidance constraints.
2. Run `pptops visual-asset-prepare <project> --brief <json>`. Inspect the structured prompt before any provider call.
3. For a fresh image, call an available ImageGen capability with the compiled prompt. For a reference edit, attach only the assets explicitly named in `reference_asset_ids` and preserve the declared invariants.
4. Do not rewrite, recompress, or replace the provider result. Ingest the exact output with `visual-asset-ingest` so its hash, dimensions, ratio, MIME/signature, and PNG alpha facts are recorded.
5. Visually inspect the exact candidate. Record subject count, semantic action, identity boundary, visible text/logo contamination, reference invariants, edge integration, and copy-safe space with `visual-asset-observe`.
6. Ask for an explicit user decision. Record accept, continue iteration, or reject with `visual-asset-decide`. Agent or automated validation is never user acceptance.
7. Only after an explicit accept, run `visual-asset-register` for one asset id and page slot. Then HTML and PPTX consume that same accepted identity.

Every retry is a new immutable generation. A reference edit records selected reference hashes, parent generation when supplied, change scope, and invariants. Never overwrite a rejected attempt or an accepted project asset.

Before freezing a Version, confirm both boundary pages contain title-only screen text and that both boundary assets resolve to their original brief and prompt, passing raster inspection, passing exact-candidate visual observation, explicit user accept decision, and immutable registration. The same check runs again before formal HTML/PPTX build, Review, Handoff, and delivery. If it fails, report the boundary role, page id, and missing evidence, then return to the earliest incomplete generation step; never substitute another asset.

## Review integration

Review must load this reference even when the selected project currently has no generated assets. It must not silently equate an empty asset registry with a completed image decision.

For each page, classify the selected visual treatment. The canonical first and final pages are always `generated-present` requirements; the optional classifications below apply to non-boundary pages:

- `native-sufficient`: editable text, native shapes, or a semantic HTML/PPTX diagram already performs the page's `visual_job` and three-second message clearly;
- `generated-needed`: a character, scene, conceptual diagram, or background is necessary because native composition is not clear enough, but no accepted registered asset fills the declared slot;
- `generated-present`: the selected Build contains a registered generated asset for the page.

`generated-needed` is a Review finding and reroutes the page to Design or Revise. Review never calls the provider, accepts a generation on the user's behalf, or changes `assets.json` or `asset_slots`.

For every `generated-present` asset, verify one continuous identity chain: Visual Asset Brief -> compiled prompt hash -> immutable generation and raster inspection -> exact-candidate visual observation -> explicit user acceptance -> registration -> `assets.json` provenance and file hash -> page `asset_slots` selection -> exact rendered Build. Render and inspect the selected page for semantic action, prohibited interpretation, subject count, identity boundary, visible or pseudo-text, logos or watermarks, reference-edit invariants, edge integration, crop, and copy-safe space. A broken, pending, rejected, continued, stale, or hash-mismatched chain cannot pass Review.

Record classification totals and page-addressable findings in the immutable Review. An empty ImageGen inventory can never pass a deck-level Review because the first/final boundary requirement would be unmet; a non-boundary page may still be explicitly classified as native-sufficient.

## Default character and scene language

The initial reusable preset is a restrained faceted low-poly editorial illustration: premium documentary-infographic tone, mature proportions, optional faceless/non-identifiable subjects, charcoal and graphite with warm ivory and muted antique gold. Avoid stick figures, childish cartoons, toy-like 3D, stock-photo poses, glossy plastic skin, presentation text, pseudo-text, logos, watermarks, and fake UI.

Example semantic request: `Three staff members gather around a planning board; one writes, one points to a bottleneck, and one checks a task card.` This is stronger than `three low-poly office people` because the action carries the slide meaning.

Example reference edit: keep the accepted character identities, posture, lighting, palette, and transparent background unchanged; replace only the planning board with a routing board and move the pointing hand to the bottleneck column.

## Truth boundary

Deterministic raster checks do not prove anatomy, action, style, cleanliness, or aesthetics. Agent/human visual observation does not prove user or business acceptance. HTML or structural PPTX success does not prove Microsoft PowerPoint acceptance. Report each layer separately and leave unperformed layers pending.
