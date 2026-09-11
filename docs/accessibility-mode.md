# Accessibility Mode (first slice)

Accessibility Mode is explicit and opt-in. It improves the shared PageSpecs; it does not create a separate “accessible version” unless a user later requests a materially different variant.

## Profile contract

Add `accessibility_profile` to a V1 `project.json`, or supply it during creation with `pptops init <dir> --accessibility-profile '<json>'`:

```json
{
  "enabled": true,
  "intent": "audit_only",
  "document_language": "en-CA",
  "reading_direction": "ltr",
  "target_formats": ["html", "pptx"],
  "text_scale": 1.25,
  "audience_needs": ["User-supplied need"],
  "organization_policies": [],
  "required_evidence": ["human_accessibility_review", "assistive_technology"],
  "assumptions": [],
  "exceptions": [],
  "unresolved_risks": []
}
```

Supported intents are `create_accessible`, `audit_only`, and `remediate`. A named standard is optional. If supplied, `standard_target` must include both an exact `name` and `version`; the tool does not infer either one.

PageSpecs may add an `accessibility` object with `language`, intended `reading_order`, `links`, `charts`, `tables`, `meaning_dependencies`, and `text_on_image`. Assets use `alt` or `long_description`, or an explicit `decorative: true` state.

## Read-only audit

Run `pptops accessibility-audit <project-dir>`. The command does not write project files. Its JSON report includes a deterministic `source_revision`, optional build revision for API callers, page-addressable findings, format capabilities, and proposed-remediation boundaries. Every remediation is marked `candidate_required` and `automatically_applied: false`; this slice does not silently change accepted pages.

The audit checks meaningful unique titles, language and semantic reading order, asset descriptions/decorative state, meaningful links, chart conclusions and alternatives, table headers/structure, single-channel meaning, media captions/transcripts and motion risks, and scaled-text capacity. Text that exceeds a large-text profile is reported for content/layout review and is never silently shrunk.

## Evidence and format boundaries

HTML and PPTX support are reported as partial. HTML already has keyboard navigation, visible focus, headings/landmarks, reduced-motion handling, and named controls, but authored language/reading order and screen-reader behavior remain incomplete or require testing. PPTX keeps editable objects and image alt text, but language, object order, real PowerPoint Accessibility Checker results, and assistive-technology behavior remain incomplete or external evidence.

The current PDF accessibility-preserving exporter is unavailable. PNG is degraded because it discards semantics. Neither is represented as an accessible equivalent.

Automated findings, human accessibility review, assistive-technology testing, real Microsoft PowerPoint Accessibility Checker results, organization approval, and legal/policy conformance are independent states. Automated success never becomes a legal or standards conformance claim.

## Deliberate remaining scope

This first slice does not implement accepted remediation application, HTML/PPTX semantic metadata and reading-order writers, real assistive-technology integrations, tagged PDF, organization-policy approval, or the complete golden-workflow set. Those remain follow-up work under issue #81.
