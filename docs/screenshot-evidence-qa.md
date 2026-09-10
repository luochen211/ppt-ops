# Screenshot evidence QA

PPT-Ops can record why a screenshot is on a slide and estimate whether its declared focal region is large enough to deserve human review. This is a composition check, not OCR and not proof that an audience can read the screenshot.

## Asset semantics

Add `screenshot_evidence` only to assets that are screenshots:

```json
{
  "id": "approval-screen",
  "type": "image",
  "file": "assets/approval.png",
  "screenshot_evidence": {
    "content_role": "read_required",
    "evidence_purpose": "Show the approved status and reviewer name",
    "focal_region": { "x": 0.72, "y": 0.04, "width": 0.24, "height": 0.18 },
    "presentation_treatments": ["zoom", "annotation"],
    "human_review_required": true
  }
}
```

Coordinates are normalized to the source image: `0,0` is the top-left and `1,1` is the bottom-right. The region must stay inside those bounds.

`content_role` has two values:

- `contextual`: the screenshot establishes product or workflow context; its internal text is not required reading.
- `read_required`: the audience must inspect something inside the screenshot. Declare at least one of `crop`, `zoom`, `callout`, or `annotation`, or set `human_review_required` to `true`.

When the same screenshot supports a different claim on another page, put a page-specific `evidence_purpose` on that page's asset slot. Reusing the same bytes with the same purpose produces a repetition finding, including when the bytes have different asset IDs.

## Review behavior

PPTX structural review maps generated image objects back to asset IDs, then reports:

- `screenshot-focal-coverage` when the declared focal area is estimated below 3% of the slide;
- `screenshot-evidence-repetition` when repeated screenshot bytes have the same evidentiary purpose;
- `screenshot-human-review-required` when internal reading is deliberately delegated to human review;
- `screenshot-reading-treatment` when read-required content declares neither a presentation treatment nor human review;
- `screenshot-evidence-contract` when required screenshot metadata is incomplete;
- `screenshot-placement-unresolved` when the PPTX image object cannot be mapped to the declared asset.

Every finding identifies both `page` and `asset_id`. The report also sets `human_readability_assessed: false`. Passing automated composition checks therefore never means that the screenshot is readable at projection distance. Rendered-slide inspection and real PowerPoint acceptance remain separate.

## Current boundary

This increment records `callout` and `annotation` as declared treatments but does not generate them. When authored, callouts and annotations should be native editable shapes in PPTX; automatic editable callout generation remains follow-up work for issue #63.
