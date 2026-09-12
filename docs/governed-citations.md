# Governed citations

PPT-Ops can turn accepted claim/source bindings from a Frozen Version into a deterministic citation manifest. Citation display is optional and never changes fact validity.

Pass an explicit citation choice to `build-create`:

```text
pptops build-create ./project --version version-001 --targets html,pptx --citations '{"decision":{"channels":["on_slide","speaker_notes","appendix"],"max_on_slide":3,"actor":"user:creator","decided_at":"2026-09-12T12:00:00Z"},"metadata":{"source-report":{"disclosure":"public","public_label":"Annual report","author_or_organization":"Example Org","title":"Annual Report","date":"2026","url":"https://example.com/report"}}}'
```

Available channels are `on_slide`, `speaker_notes`, `appendix`, and `internal_only`. Existing projects keep their current behavior when `--citations` is omitted.

Only metadata explicitly classified `public` can enter audience-facing channels. `organization_internal`, `restricted`, and `undisclosed` sources remain `internal_only`; local paths, locators, URLs, titles, and organization names are not copied into rendered artifacts. Missing public bibliography fields remain pending rather than being invented.

The manifest pins the fact-ledger revision, source and extraction hashes, locators, claim revisions, exact Page Spec bindings, disclosure decision, and output channels. Shared sources receive stable numbering for the same Frozen Version and decision.

On-slide delivery has a fixed capacity. Overflow fails with `CITATION_REGION_OVERFLOW`; the renderer does not silently shrink citations. Appendix pages become part of that Build's page sequence. HTML and PPTX render independently from the same manifest, and PPTX citations remain native editable text.

Title-only first and final pages retain the existing boundary-image contract. A visible citation bound to either boundary fails with `CITATION_BOUNDARY_CONFLICT`; choose speaker notes or an appendix instead.

Review reports citation coverage, unresolved bibliography fields, disclosure scope, and hyperlink findings separately from fact-ledger validity. Handoff pins the same citation-manifest revision and unresolved findings.
