# Accessibility Mode

Accessibility Mode is explicit and opt-in. It improves the shared project by default. Create a separate audience variant only when the user requests one or supplies incompatible delivery requirements.

Declare `accessibility_profile` in a V1 project, or pass it to `init --accessibility-profile`:

```json
{
  "enabled": true,
  "intent": "create_accessible",
  "document_language": "en-CA",
  "reading_direction": "ltr",
  "target_formats": ["html", "pptx"],
  "text_scale": 1.25,
  "required_evidence": ["human_accessibility_review", "assistive_technology"],
  "audience_needs": [],
  "organization_policies": [],
  "assumptions": [],
  "exceptions": [],
  "unresolved_risks": []
}
```

Intents are `create_accessible`, `audit_only` and `remediate`. A named standard is optional; if requested, record its exact name/version and the evidence the user requires. Never infer a policy or conformance claim.

PageSpecs can declare language, intended `reading_order`, meaningful links, chart conclusions and alternatives, table headers/rows, meaning dependencies and uncertain image regions. Reading-order names describe rendered groups: `title`, `subtitle`, `message`, `body`, `assets`, `diagram`, `alternatives`. The actual groups differ by output and page layout; an unmatched or reordered group is a finding, not an automatic rewrite. Assets can be explicitly decorative or carry slot-local/asset alternative text and long descriptions.

## Audit and reviewed remediation

`accessibility-audit <project-dir>` is read-only. It reports exact semantic source revisions and page-addressable findings. `--build <id>` reads the selected Build and frozen snapshot without opening or updating the metadata database, verifies the frozen snapshot hash, and includes actual artifact hashes, HTML DOM evidence and editable PPTX XML/object order.

For a named external presentation, pass `--html-file <file>` and/or `--pptx-file <file>` against the project's declared semantics and profile. External HTML inspection disables scripts and resource loading; external PPTX inspection uses bounded XML extraction. External-artifact options cannot be mixed with `--build`.

The audit checks titles, language/order, images, links/charts/tables, non-color meaning, media requirements, scaled capacity, resolved theme/page colors and supplied region color samples. Artifact checks inspect the language and image metadata that was actually written, native shrinking settings, media tracks and actual reading order. Image/gradient/transparent regions remain human-review findings. Missing inspection tools are explicitly degraded.

Contrast uses the [WCAG 2.2 relative-luminance formula](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). The design audit uses a conservative 4.5:1 text threshold; rendered HTML checks use its actual text size/weight to distinguish normal and large text. Results concern the inspected color pairs only. They do not establish WCAG or legal conformance.

`accessibility-remediate <project-dir> --payload <json>` takes `source_revision`, `page_id`, a page-scoped `patch` and a plain-language `reason`. It rejects stale audits and returns a Candidate plus a diff. It does not apply the correction. Continue through existing Candidate rendering, exact PowerPoint observation and explicit user acceptance. Other pages and frozen outputs remain unchanged. Proposing another correction requires a current audit after source changes.

## Renderer behavior and evidence limits

HTML writes declared document/page language, direction and scaled font sizes. Boundary titles precede images in the DOM while retaining visual geometry. Images expose descriptions or an explicit decorative state; user-supplied links, chart descriptions and simple data tables have a keyboard-accessible details control. Navigation controls have names and visible focus, including on boundary slides; reduced-motion behavior remains available.

PPTX remains editable, writes document and text-run language, applies direction and font scaling, and records image descriptions. Accessibility Mode disables automatic text shrinking. Both builders reject declared scaled-capacity violations; rendered HTML/PowerPoint QA still checks actual geometry because character capacity cannot prove visual fit.

PPTX object order is inspected independently of the semantic/HTML order. Drawing order can differ, especially where a boundary image sits behind its title. Independent assistive reading-order and decorative flags are unsupported by the current writer. Full native table/chart alternatives and media support remain explicit limitations that require review; an unsupported requirement cannot receive a fabricated pass. HTML media without actual captions/transcripts receives artifact findings even when source metadata names a file.

Tagged PDF export is unavailable. PNG discards semantics. The capability matrix reports each requested output separately.

Review and Handoff include the declared profile, unresolved findings, exceptions, capabilities and evidence states. Automated checks, human accessibility review, assistive-technology testing, real PowerPoint Accessibility Checker results, organization approval and legal/policy conformance remain independent. The golden workflows use synthetic acceptance records to test state transitions; they do not certify real assistive-technology usability or replace human acceptance.
