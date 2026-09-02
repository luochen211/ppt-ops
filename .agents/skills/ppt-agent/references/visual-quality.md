# Visual Quality Reference

This reference adapts production lessons from `guizang-ppt-skill` to PPT-Ops without turning that web-slide Skill into a runtime dependency. Apply the principles to both native PPTX and optional HTML artifacts; do not copy WebGL, CDN, Swiss-layout-lock, or other web-only machinery into PPTX.

## Before rendering

- Give every page one cognitive job, one three-second message, and one semantic relation.
- Choose the opening by its job: result, evidence, question, image, memorable glyph, or formal framing. Do not default every deck to a centered title cover.
- Plan rhythm before decoration. Alternate dense pages with breathing pages and avoid repeating the same visual structure three times in succession.
- Treat images as evidence or explanation, not filler. Declare their role and use a standard destination ratio.
- Keep one coherent theme and one accent hierarchy. Typography, spacing, and contrast must establish the information order.

## Automated and rendered review

- Fail over-capacity text instead of silently shrinking it below readable size.
- Flag emoji used as functional icons, missing source references, clipped or out-of-bounds objects, unintended overlap, excessive density, undeclared fonts, and inconsistent image slots.
- Confirm that titles do not collapse into one-character lines and that body/caption text remains readable at presentation scale.
- Confirm page numbers, keyboard navigation, total slide count, asset containment, and fullscreen controls for HTML artifacts.
- For HTML collision gates, annotate protected nodes/content and real connector elements with stable `data-qa-*` roles. Connector penetration is rejected by default; intentional overlap requires a narrow markup allowlist. CSS pseudo-elements do not count as inspectable semantic connectors.
- Render representative pages and every page with a structural finding. Code inspection alone is not visual acceptance.

## Human review prompts

- Can the page's intended message be understood in roughly three seconds?
- Is the selected semantic layout appropriate for the content shape rather than merely decorative?
- Do title weight, spacing, image alignment, page rhythm, and bottom navigation safe areas feel deliberate?
- Are images legible, consistently cropped, and subordinate to their evidentiary purpose?
- In Microsoft PowerPoint, can a reviewer copy an object, edit text, play the deck, and confirm fonts without destructive substitution?

Record automated, rendered, human visual, real PowerPoint, and business acceptance separately. A screenshot, exported PDF, or automated renderer is evidence for review, never a substitute for a named human decision.
