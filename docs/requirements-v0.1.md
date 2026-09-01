# PPT-Ops v0.1 Requirements

## 1. Delivery goal

Build a local-first presentation production workspace that turns a structured project and shared page specifications into two independent delivery formats:

1. an HTML presentation for rapid preview, sharing, and motion-rich review;
2. an editable PPTX presentation for PowerPoint delivery and live playback.

HTML must not be converted into PPTX. Both renderers consume the same normalized project and page model.

## 2. Intended users

The first release serves individual creators, course teams, consultants, and delivery studios that already have source material such as a transcript, brief, existing deck, or brand assets.

## 3. In scope

- A versioned project manifest and page specification contract.
- A CLI that can inspect, validate, prototype, build, review, and package a project.
- Deterministic HTML generation from approved page specifications.
- Editable PPTX generation from approved page specifications.
- Shared theme tokens for dimensions, typography, color, spacing, and asset references.
- Structural validation before build.
- Output-level validation appropriate to each format.
- A demo project proving that one page model can drive both renderers.
- Local build outputs and a machine-readable review report.

## 4. Explicit non-goals

- No HTML-to-PPTX conversion.
- No browser-based collaborative editor in v0.1.
- No automatic publishing or hosting in v0.1.
- No promise that HTML and PPTX are pixel-identical.
- No autonomous invention of business facts, evidence, data, or customer stories.
- No attempt to support every presentation style or PowerPoint feature.
- No AI image generation in the initial repository milestone.

## 5. Core flow

1. The user creates or imports a project directory.
2. PPT-Ops loads `project.json`, `pages.json`, source files, theme tokens, and assets.
3. `review` rejects invalid or incomplete page specifications.
4. `prototype` selects a bounded page subset for direction review.
5. `build --format html` produces a self-contained HTML presentation.
6. `build --format pptx` produces an editable 16:9 PPTX presentation.
7. `review` records structural and output checks without claiming visual approval.
8. `handoff` packages the available outputs and review evidence.

## 6. Shared data rules

Every page must define:

- page number;
- source reference when available;
- cognitive task;
- three-second message;
- information relation;
- approved on-screen text;
- visual job;
- asset slots;
- lifecycle status.

The shared model describes semantic intent. Renderer-specific geometry may be stored in namespaced optional fields, but it must not overwrite shared content or meaning.

## 7. Renderer responsibilities

### HTML

- Render a 16:9 slide stage and keyboard navigation.
- Use semantic HTML, CSS, and local assets.
- Support restrained transitions without making motion required for comprehension.
- Produce a directly openable HTML artifact.

### PPTX

- Produce a valid 16:9 PowerPoint file.
- Keep titles, body text, simple diagrams, and standard shapes editable.
- Use declared fonts and theme colors.
- Avoid negative geometry and unsupported external font loading.

## 8. CLI contract

```text
pptops intake <project-dir>
pptops outline <project-dir>
pptops prototype <project-dir> --pages <list>
pptops build <project-dir> --format html|pptx
pptops review <project-dir>
pptops handoff <project-dir>
```

Commands exit non-zero on invalid input or failed required checks. Generated artifacts are written below the project's `outputs/` directory and do not overwrite source material.

## 9. Acceptance criteria

The v0.1 milestone is complete only when all of the following are observable:

- A clean clone can install dependencies and run the test suite.
- The demo project passes schema and semantic validation.
- The same demo `pages.json` builds both HTML and PPTX outputs.
- The HTML output opens locally and every demo page is navigable.
- The PPTX output is a structurally valid 16:9 deck with editable text.
- Invalid page numbers, missing required text, invalid relations, duplicate pages, and missing assets fail validation.
- Review output distinguishes automated checks from visual and real-PowerPoint acceptance.
- The README documents setup, commands, project layout, outputs, and known limits.
- CI runs tests and the demo build on pushes and pull requests.

## 10. Named unknowns deferred beyond v0.1

- Public SaaS packaging and pricing.
- Online hosting and share links.
- Brand-template marketplace.
- AI-assisted transcript-to-page-spec generation.
- PowerPoint round-trip editing of an existing deck.
