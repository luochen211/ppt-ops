---
name: ppt-agent
description: Generate, revise, validate, and deliver editable PowerPoint decks from a topic, notes, Markdown, DOCX, or PPTX inside Codex. Use for 做PPT、生成PPT、修改PPT、可编辑PPTX or presentation delivery; this is a conversation-driven agent workflow, not a web app.
---

# PPT Agent

Turn the user's intent and source material into a traceable PPT-Ops project and a validated, editable `.pptx`. Codex conversation is the product interface; `pptops` is an internal tool.

## Operating contract

- Work inside a named project directory. Never overwrite a non-empty directory or an existing handoff package.
- Treat user files and confirmed facts as the content source of truth. Do not invent metrics, cases, quotations, customers, or promises.
- Ask only when audience, purpose, or a high-impact creative choice cannot be inferred. Otherwise state assumptions and continue.
- Keep AI proposals separate from accepted project state. Show the outline or a compact summary before making a large or irreversible revision.
- Generate native, editable PPTX elements with PptxGenJS. HTML is an optional output artifact, never the product interface and never an intermediate conversion step for PPTX.
- Distinguish automated validation from visual review and real PowerPoint acceptance.

## Workflow

1. Inspect the request and available source files. Establish audience, purpose, language, approximate length, delivery context, style, and required facts.
2. Create the project with `node src/cli.js init <project-dir> --title <title>`. Import supplied Markdown, DOCX, or PPTX with `node src/cli.js import <project-dir> --file <file>`.
3. Build a narrative chain and slide plan. Each page needs one cognitive job, one three-second message, source references, a semantic relationship, and a suitable template.
4. Update the V1 project entities without bypassing their contracts. Validate with `node src/cli.js validate <project-dir>` after structural changes.
5. Generate a representative prototype when visual direction is uncertain. Incorporate feedback locally; do not regenerate approved, unrelated pages.
6. Build with `node src/cli.js build <project-dir> --format pptx`.
7. Run `node src/cli.js review <project-dir>` and inspect rendered evidence when local rendering tools are available. Fix overflow, clipping, accidental overlap, broken assets, and unreadable density.
8. Package with `node src/cli.js handoff <project-dir>`. Deliver the `.pptx`, review report, source provenance, and unresolved human acceptance items.

## Tool selection

- Use the repository's PptxGenJS renderer for authoring. Its output remains editable in PowerPoint.
- Use the built-in Source Intake first. Read [references/tooling.md](references/tooling.md) before adding or replacing extraction or rendering dependencies.
- Use image generation only when a slide genuinely needs bespoke imagery. Keep generated image assets separate from editable text and shapes.

## Completion boundary

Do not say the deck is fully accepted merely because it builds. Report separately: contract/tests, PPTX structure, rendered visual inspection, real Microsoft PowerPoint editing/playback, and user/business approval.
