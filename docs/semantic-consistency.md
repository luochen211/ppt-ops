# Cross-deliverable semantic consistency

PPT-Ops can model shared learning objectives, glossary terms, controlled actions, risk levels, and numbering definitions with stable IDs. PPTX, DOCX, PDF, assessment, and alignment-report sources bind original text and format-specific locations to an exact semantic revision.

The checker reports conflicts, missing coverage, stale revisions, and one-to-many mappings. Findings preserve the artifact, locator, original text, expected canonical value, and a `human_required` resolution. It never chooses a conflicting version or rewrites a deliverable.

## Locator boundary

- PPTX uses `slide`.
- DOCX uses `word_page` or `section`.
- PDF uses `pdf_page`.
- Assessments use `assessment_item`.
- Alignment sources use `alignment_row`.

These locator kinds are deliberately not interchangeable; “slide 7,” “Word page 7,” and “PDF page 7” are different evidence.

## Acceptance boundary

The included Hazard delivery fixture is synthetic regression evidence only. Formal acceptance additionally requires exact hashes for an authorized real presentation, learner guide, assessment, and alignment report plus a named instructional designer’s explicit acceptance. Automated consistency passing never substitutes for content approval.
