# ADR 0002: Mandatory generated visuals at deck boundaries

- Status: Accepted
- Date: 2026-09-02

## Decision

The canonical first and final PageSpec of every formally produced deck must each select at least one `generated_image` registered through the Visual Asset Pipeline. A one-page deck may use one accepted image for both roles.

The formal lifecycle resolves each selected asset back to its immutable brief, compiled prompt hash, generation manifest, passing raster inspection, passing exact-candidate visual observation, explicit user accept decision, registration record, and unchanged accepted bytes. Version freeze, HTML/PPTX build, Review, Handoff, and delivery fail before renderer or package mutation when any link is missing or contradictory.

Foundation projects remain readable, validatable as drafts, and migratable, but can no longer enter a formal build through a compatibility path. Static images, SVGs, screenshots, native shapes, and hand-written provenance are not substitutes.

## Consequences

- Design must reserve and complete ImageGen work for both boundary pages before Version freeze.
- Formal build remains offline once accepted assets and their local evidence exist; live provider access is not required during rendering.
- Automated raster facts, visual observation, user acceptance, Microsoft PowerPoint inspection, and business acceptance remain separate claims.
- Handoff manifests record the exact accepted boundary asset IDs, generation IDs, and hashes.
- Old Foundation projects must migrate to V1 and complete boundary generation before formal output.
