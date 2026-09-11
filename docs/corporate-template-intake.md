# Corporate template and reference profiles

Corporate PPTX/POTX, HTML and PDF inputs are design evidence. They remain separate from content Sources: imported copy, customer names and claims never become project facts. Originals and inspections live under the protected Project/User Layer at `.pptops/templates/corporate/` and are excluded from system updates.

The `corporate-template` application command supports `import`, `status`, `compare`, `preview`, `accept` and `apply`; each action takes a JSON payload. Import needs the named local `file`. Compare takes `inspection_files` and returns each immutable inspection's SHA-256 plus every conflicting observation.

Acceptance requires an explicit `actor` (`user` or `user:<id>`), verbatim `raw_feedback`, the selected `inspection_files` and their exact `inspection_revisions`. Every conflicting field requires a `precedence` entry naming the winning profile ID. Selected rules reference their inspection, observation index and optional value index; the supported targets are `colors.background`, `colors.text`, `colors.accent`, `typography.heading_font`, `typography.body_font` and 16:9 `dimensions`. Unsupported conversions fail visibly. Font availability remains unverified until checked on the delivery computer.

`layout_mappings` select an inspected native `layout_id` or an HTML/PDF `reference_page`, a `semantic_family` from the PPT-Ops catalog and explicit target `page_ids`. The mapped family must support each page's relation. The mapping records the user's interpretation; it does not claim to preserve arbitrary master geometry. Unselected layouts remain in the original inspection.

The resulting accepted profile is immutable and content-addressed. Apply takes its `file` and `sha256`, the current `project_revision` returned by status as `expected_revision`, and a separate explicit user decision. Apply updates only the project's profile pointer. Draft reads and frozen Versions materialize accepted rules without rewriting source facts, authored pages or the base theme file. Page theme overrides remain local. A changed source, inspection, accepted profile or stale project decision fails closed.

Frozen snapshots include the full accepted profile; Version, Build, Review and Handoff carry its identity. HTML and editable native PPTX consume that same materialized semantic profile independently. Audience variants inherit their pinned base profile; local page overrides stay isolated, and existing frozen outputs are retained.

## Format evidence and remaining acceptance

| Input | Inspection and preview | Limit |
|---|---|---|
| PPTX/POTX | Bounded Open XML dimensions, colors/fonts, masters, layouts, placeholders and media locators | Native reference rendering and corporate font/master fidelity still require separately recorded PowerPoint inspection |
| HTML | Static DOM/CSS plus optional computed section styles and a viewport PNG | Preview disables scripts and all local/network subresources; blocked assets can change the appearance; HTML is never a PPTX master |
| PDF | `pdfinfo` page metadata where available, static font/action findings, optional first-page `pdftoppm` PNG | Static fallback is limited to uncompressed objects; no editable placeholders or semantic intent are inferred |

Preview evidence is stored separately and never changes an accepted profile. Missing tools produce an explicit degraded result. Macro, OLE, active HTML and external-resource findings remain visible; original active features and corporate media are not executed or copied into generated presentations.

Automated tests cover all four input formats through explicit selection, freeze, HTML/PPTX build, Review, Handoff and variant inheritance, as well as rejected stale/conflicting decisions and an actual contained Chromium preview. These synthetic workflows do not constitute corporate brand approval or real PowerPoint acceptance. Rendered comparison with organization-supplied references, native master/media reuse and real corporate-font acceptance remain open under #78.
