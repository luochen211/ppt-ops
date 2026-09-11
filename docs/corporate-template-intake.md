# Corporate template and reference intake

Corporate presentation identity may arrive as PPTX/POTX, HTML, or PDF. These inputs are inspected as design evidence, separately from content Sources. Imported slide copy, examples, metrics, and customer names never become project facts merely because they occur in a template/reference file.

`CorporateTemplateIntake` stores the untouched original and a normalized proposed profile under `.pptops/templates/corporate/<format>/<sha256>/`. Re-importing identical bytes in the same format returns the same immutable inspection. A profile remains `proposed`; this first slice does not apply it to a Theme, renderer, Version, Build, Review, or Handoff.

## Capability boundary

| Input | Inspection evidence | Explicit limit |
|---|---|---|
| PPTX/POTX | Open XML slide size, theme colors/fonts, masters, layouts, placeholders, media | Structural extraction does not prove PowerPoint fidelity or safe feature preservation |
| HTML | Static DOM/CSS strings, local references, inferred page geometry | Scripts and remote resources are never run; HTML is not a PPTX master |
| PDF | Fixed-page count, boxes, named fonts, unsafe action indicators | No editable placeholders, semantic intent, or PowerPoint master can be claimed |

Every observation carries an evidence type and locator. Findings record active or external content without executing or fetching it. When multiple profiles disagree, `detectCorporateTemplateConflicts` produces an explicit precedence decision instead of silently merging values.

Follow-up work may add user acceptance, semantic layout mapping, renderer/master application, audience-variant reuse, rendered comparison, and real Microsoft PowerPoint inspection.
