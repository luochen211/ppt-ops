# PPT-Ops V1.0 Requirements

## Delivery goal

V1.0 turns the validated v0.1 dual-renderer foundation into a usable local CLI workflow. A creator can start a project outside this repository, validate it, build HTML and editable PPTX outputs together, and produce an evidence-bearing handoff package without manually assembling the project contract.

## Product workflow plan (2026-09-11)

The product has three planned entry points, specified in the [core workflow plan](core-workflows-plan.md):

- Transcript to PPT: produce and confirm the outline before generating the deck.
- Structure to PPT: continue from a supplied chapter outline or per-slide structure; expand chapters into pages only when necessary.
- Existing PPT visual refinement: improve layout, typography, colors, image placement, and supported chart styling while preserving wording, facts, data, slide order, and the established brand style unless a style change is requested.

Copy editing and narrative restructuring are future work for the refinement entry point. They are not prerequisites for visual refinement and do not change the necessary content preparation in the two generation workflows. Existing content review remains a separate capability.

This is a requirements update, not a claim that all three workflows have shipped. Visual refinement must produce an editable PPTX and before/after previews, preserve untargeted pages, and pass real PowerPoint checks. The existing CLI acceptance criteria below remain evidence of the implemented foundation only.

## User workflow

```text
pptops init <project-dir>
  -> edit brief, page specifications, theme, and assets
pptops validate <project-dir>
  -> correct contract or reference errors
pptops prototype <project-dir> --pages 1,2
  -> review bounded page intent
pptops deliver <project-dir>
  -> build configured HTML/PPTX outputs, review, and package
```

## V1.0 acceptance criteria

- `init` creates a valid 1.0 project with a safe starter page, theme, brief, and empty asset manifest.
- `init` refuses to overwrite a non-empty directory.
- `validate` provides a dedicated, scriptable contract check.
- `build --format all` produces HTML and PPTX in one invocation.
- `deliver` builds configured supported outputs, writes the review report, and creates a non-overwriting handoff package.
- Existing 0.1 projects remain readable and buildable.
- CLI options fail clearly when malformed or unknown.
- Package and CLI version report `1.0.0`.
- Automated checks, human visual acceptance, and real PowerPoint acceptance remain separate claims.

## Boundaries retained from v0.1

- HTML and PPTX are independent renderers over the same semantic page model.
- V1.0 does not invent business facts or claim visual approval from structural checks.
- V1.0 does not provide online collaboration, automatic publishing, or HTML-to-PPTX conversion.
- Existing PPTX intake currently extracts traceable source content. Controlled visual editing of the original deck is planned and still requires implementation and acceptance; text extraction followed by full regeneration does not satisfy this workflow.
- Arbitrary lossless preservation of every PowerPoint feature is not promised. Unsupported objects must be preserved and their editing limits reported rather than silently removed or flattened.
