# Building with Design System Pack IDs

Both foundation and v1 projects can set `project.json.design_system_pack_file`
to a project-relative JSON file, for example `pack.json`. Each page selects a
stable resource ID with `design_system_layout_id`. `readProject` loads and
validates the pack, and preserves the page selector. Asset `source` paths are
relative to the project root, not the pack file directory. Paths cannot escape
the project root. V1 frozen versions embed the pack document in their snapshot;
changing the working pack does not change a frozen version's resource semantics.
As with existing project assets, image files remain project-local file references.

A renderable layout contains a compatible built-in `template_id`, optional
`semantic_family`, typed `component_ids` and `asset_ids`, and independent
implementation IDs. For example:

```json
{
  "id": "layout-cover",
  "template_id": "template-hero",
  "semantic_family": "hero",
  "component_ids": ["component-tag"],
  "asset_ids": ["asset-mark"],
  "renderers": { "html": "html-pack-split", "pptx": "pptx-pack-stacked" }
}
```

The HTML implementations are `html-pack-split` (copy beside images) and
`html-pack-stacked` (images below copy). The native PowerPoint implementations
are `pptx-pack-split` and `pptx-pack-stacked`. Each adapter independently builds
its own structure and placement. Unknown implementation IDs fail compilation.
The implementations can be mixed between targets; changing one does not change
the other.

Selected components currently support `type: "label"` with `text` of 1–80
characters, at most three per page. HTML emits visible label elements; PPTX emits
editable text shapes. A component example is
`{"id":"component-tag","type":"label","text":"Safety first"}`.
Selected assets support `image`, `icon`, `background`, or `illustration`, with a
local PNG/JPEG/SVG `source`; these are rendered in image slots, with optional
`alt`. For example:
`{"id":"asset-mark","type":"illustration","source":"assets/mark.png","alt":"Safety mark"}`.
The same resources can be reused on multiple pages. These implementations use
image slots rather than treating a background resource as an entire slide.

Missing/wrong-kind references, malformed ID arrays, unsupported selected resource
representations, and incompatible semantic families fail explicitly. Page and
pack asset IDs cannot resolve to different files. Layout/component capacity
limits narrow the built-in template limits; selected image slots count toward
capacity. Capacity checks do not prove rendered fit.

Focused tests load real persisted foundation/v1 fixtures, inspect HTML resource
structure and PPTX pictures/editable text, compare independent mapping changes,
and check frozen resource semantics. Browser evidence checks placement and deck
navigation. None of these constitute real Microsoft PowerPoint or human visual
acceptance; those remain separate parent-issue gates.

## Multipage machine acceptance

`validateDesignSystemCase` is asynchronous. Supply the pack, V1 `pages`, normalized
`theme` and `project`, and a local `root` for asset resolution. It checks page
contracts and unique page identities, compiles the selected layouts, and builds
HTML and native PPTX independently. Failures return `status: "failed"` and findings.
The six semantic layouts and three asset types are counted from selected, valid
pages, not unused catalog declarations. Reuse means the same valid resource is
referenced on more than one distinct page.

The synthetic six-page case is in
`test/fixtures/design-system-pack/multipage-reuse.json`; its three local PNGs
represent a grid, an arrow and an orbit. Run
`node --test test/design-system-case.test.js` to check embedded images and reusable
labels in the HTML sections and PPTX slide XML/media relationships, plus invalid
contracts, resource selections and build inputs.

These are automated construction/output checks. They do not establish visual
fidelity in Microsoft PowerPoint or a human acceptance decision. The separate
`powerpoint` and `human_visual_review` gates remain `pending` unless supplied with
an external accepted record; automated builds do not promote either gate.
