# Review Mode

When the user asks only for content, audience-value, terminology, theory, or speaker-note review, select the routing contract's `content_only` variant and follow `content-review.md`. This path needs no Build, creates a content report only, and exits before the build and ImageGen procedures below. It neither changes accepted pages nor claims formal Review acceptance.

For a full Build Review, also read any content-review report tied to its source revision. Mark outdated reports as stale; record unresolved content findings separately from visual defects. Run new DBS analysis only for requested content checks or changed claims, scoped to the affected pages.

Validate the selected Build and record page-addressable automated evidence. Apply both `visual-quality.md` and `visual-assets.md`; render and inspect when a renderer is available.

Before Review, re-verify that the canonical first and final pages each resolve to an accepted pipeline-registered ImageGen asset; stop if either boundary is missing or inconsistent. A one-page deck may use one accepted image for both roles.

Always perform the ImageGen decision and evidence audit, including when `assets.json` or every `asset_slots` list is empty. Classify each page's visual treatment as native-sufficient, generated-needed, or generated-present. The first and final pages must be generated-present, so an empty inventory stops Review. Non-boundary pages may be native-sufficient when editable text and native shapes perform the page's three-second job clearly. If another generated asset is needed but absent, record a page-addressable finding and route the page to Design or Revise after Review; Review does not call an image provider or mutate asset state.

For generated-present pages, verify the complete accepted identity from brief and immutable generation through visual observation, explicit user acceptance, registration, asset hash, selected page slot, and the exact rendered Build. Inspect semantic action, prohibited interpretation, subject count, identity boundary, visible text or logo contamination, reference-edit invariants, edge integration, crop, and copy-safe space. Pending, continued, rejected, stale, or hash-mismatched attempts cannot pass as selected assets.

Report the visual-asset inventory, classification counts, generated-asset evidence findings, automated checks, rendered inspection, Agent or human visual observation, explicit user acceptance, real Microsoft PowerPoint acceptance, and business acceptance separately. Missing evidence stays pending. Exit with an immutable Review record.
