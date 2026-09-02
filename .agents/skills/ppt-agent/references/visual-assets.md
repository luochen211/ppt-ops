# Visual Asset Pipeline

Use generated raster assets only when a character, scene, conceptual diagram, or background does a page job that native PowerPoint text and shapes cannot do clearly enough. The page `visual_job` and three-second message come first; a style label such as low-poly is never the semantic request.

## Controlled workflow

1. Create a minimal Visual Asset Brief for one named page and slot. Declare subject count, action, prohibited interpretation, identity boundary, composition, ratio, text policy, transparency, copy-safe space, and avoidance constraints.
2. Run `pptops visual-asset-prepare <project> --brief <json>`. Inspect the structured prompt before any provider call.
3. For a fresh image, call an available ImageGen capability with the compiled prompt. For a reference edit, attach only the assets explicitly named in `reference_asset_ids` and preserve the declared invariants.
4. Do not rewrite, recompress, or replace the provider result. Ingest the exact output with `visual-asset-ingest` so its hash, dimensions, ratio, MIME/signature, and PNG alpha facts are recorded.
5. Visually inspect the exact candidate. Record subject count, semantic action, identity boundary, visible text/logo contamination, reference invariants, edge integration, and copy-safe space with `visual-asset-observe`.
6. Ask for an explicit user decision. Record accept, continue iteration, or reject with `visual-asset-decide`. Agent or automated validation is never user acceptance.
7. Only after an explicit accept, run `visual-asset-register` for one asset id and page slot. Then HTML and PPTX consume that same accepted identity.

Every retry is a new immutable generation. A reference edit records selected reference hashes, parent generation when supplied, change scope, and invariants. Never overwrite a rejected attempt or an accepted project asset.

## Default character and scene language

The initial reusable preset is a restrained faceted low-poly editorial illustration: premium documentary-infographic tone, mature proportions, optional faceless/non-identifiable subjects, charcoal and graphite with warm ivory and muted antique gold. Avoid stick figures, childish cartoons, toy-like 3D, stock-photo poses, glossy plastic skin, presentation text, pseudo-text, logos, watermarks, and fake UI.

Example semantic request: `Three staff members gather around a planning board; one writes, one points to a bottleneck, and one checks a task card.` This is stronger than `three low-poly office people` because the action carries the slide meaning.

Example reference edit: keep the accepted character identities, posture, lighting, palette, and transparent background unchanged; replace only the planning board with a routing board and move the pointing hand to the bottleneck column.

## Truth boundary

Deterministic raster checks do not prove anatomy, action, style, cleanliness, or aesthetics. Agent/human visual observation does not prove user or business acceptance. HTML or structural PPTX success does not prove Microsoft PowerPoint acceptance. Report each layer separately and leave unperformed layers pending.
