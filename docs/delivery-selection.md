# User-selected delivery formats

Export format is a user decision made after the relevant artifact is accepted. It is not a design input and no format is selected implicitly.

Presentation choices are self-contained HTML, editable PPTX, and PDF. Approved-outline choices are Markdown, DOCX, and PDF. The capability response must mark formats as available or unavailable; an unavailable request returns `EXPORTER_UNAVAILABLE` and preserves all accepted work.

Each explicit decision is written immutably under `.pptops/delivery-selections/<id>/manifest.json` with artifact type, selected formats, source build or outline identity, source revision, actor, conversation/API source, and decision time. Reselection creates another decision instead of editing the prior record. A Handoff references that immutable selection by ID, packages only the selected build targets, and embeds the stored decision in its manifest. Renderer outputs and frozen Versions are never overwritten.

The current first phase supports HTML/PPTX presentation artifacts already present in an eligible Build and native Markdown outline export. PDF and DOCX are advertised as unavailable until dedicated, traceable exporters are wired in; no renderer is converted into another renderer's source.

Agent wording should stay user-facing:

> Your presentation is ready. Which formats do you want: HTML, editable PowerPoint, PDF, or more than one?

> Do you want the approved outline as Markdown, Word, PDF, or more than one?

Do not mention internal renderer names or silently fall back. If a choice is unavailable, say which one and offer the remaining choices without rerunning content or design.
