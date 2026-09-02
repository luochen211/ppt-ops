# Visual Asset Pipeline Requirements

> Status: implementation scope approved in the 2026-09-02 planning conversation
>
> Target: PPT-Ops V1 Foundation extension
>
> Delivery boundary: local-first Codex Agent workflow, provider-neutral Core, HTML and native PPTX consumers

## 1. Goal

Turn a page's approved `visual_job` and asset slot into a traceable visual-asset workflow that can reproduce the strongest behavior from the archived presentation cases:

1. describe the semantic job of a character, scene, diagram, or background;
2. compile a structured image-generation prompt;
3. generate a fresh image or edit a selected reference image;
4. preserve every attempt, prompt, provider response, parent/reference relationship, and file hash;
5. validate the produced raster without overstating visual acceptance;
6. let a user accept one candidate;
7. register the accepted asset in the project and render the same asset in HTML and native PPTX.

The primary success measure is not the number of images generated. It is whether a generated visual performs the page's three-second cognitive job while remaining auditable, replaceable, and safe to compose with editable PowerPoint text.

## 2. Intended users

- course teams and speakers who need coherent editorial characters across a deck;
- consultants and studios delivering editable PPTX files;
- Codex Agents that need deterministic boundaries around an image-generation tool;
- reviewers who need to distinguish generated-file checks from visual and business approval.

## 3. In scope

### 3.1 Visual asset briefs

PPT-Ops must support a structured brief for four asset roles:

- `character`: one or more people whose action carries meaning;
- `scene`: people, objects, and environment expressing one situation;
- `diagram`: a raster conceptual relationship that native shapes cannot express adequately;
- `background`: a composition plate with declared copy-safe negative space.

Every brief must declare:

- owning page and asset-slot role;
- semantic goal and three-second message;
- fresh generation or reference edit;
- subject count, identity boundary, action, pose, props, and prohibited interpretations;
- visual style, composition, framing, palette, lighting, and backdrop;
- copy-safe zones and intended destination ratio;
- text policy, evidence policy, transparency requirement, and avoidance list;
- for reference edits, the exact change scope and invariants that must remain unchanged.

### 3.2 Prompt compilation

The default prompt compiler must emit a stable, structured English prompt using these sections when applicable:

```text
Use case
Asset type
Primary request
Scene/backdrop
Subject
Style/medium
Composition/framing
Lighting/mood
Color palette
Text
Constraints
Avoid
```

The prompt must lead with the visual's semantic action. Style words such as `low-poly` must not substitute for the action or information relationship.

The initial reusable editorial preset must preserve the proven visual language from the archived cases:

- restrained faceted low-poly editorial illustration;
- premium documentary-infographic tone;
- mature proportions, with optional faceless or non-identifiable subjects;
- charcoal, graphite, warm ivory, and muted antique-gold palette;
- no generated presentation copy, logo, watermark, fake UI, or pseudo-text;
- explicit negative constraints against stick figures, childish cartoons, toy-like 3D, and stock-photo poses.

### 3.3 Generation and reference editing

Core must expose a provider-neutral image-generation interface. A provider request contains only the compiled prompt, requested dimensions/ratio, and explicitly selected reference assets.

The Codex Agent may satisfy this interface with its available ImageGen capability. Tests use a deterministic fake provider; Core must not require a live external service.

Two modes are required:

- `fresh`: produce a new candidate without image references;
- `reference_edit`: modify named accepted or generated assets while recording `parent_generation_id`, `reference_asset_ids`, `change_scope`, and invariants.

Every attempt is immutable. A retry creates a new generation record and a new output file; it never overwrites a prior attempt.

### 3.4 Validation and evidence

Automated checks must record, at minimum:

- file exists within the project root;
- allowed raster signature and MIME;
- byte size, SHA-256, width, height, and aspect ratio;
- whether a PNG carries an alpha channel when transparency is required;
- whether the candidate matches the requested destination ratio within the declared tolerance.

Automated raster checks must not claim that anatomy, subject count, style, copy-safe space, absence of visible text, or semantic action is correct unless an actual visual inspector supplied that observation. Those checks remain `pending` until recorded by a named Agent/human observation.

Visual observations must separately cover:

- semantic action and prohibited interpretation;
- subject count and identity boundary;
- visible text, pseudo-text, logo, or watermark contamination;
- reference-edit invariants;
- edge/background integration and copy-safe space.

User acceptance is separate from automated validation and Agent visual observation.

### 3.5 Acceptance and registration

Only a candidate with successful required automated checks and a recorded visual observation can be presented as ready for user acceptance. Only a user-accepted generation may be registered as the asset selected by a page slot.

Registration must preserve:

- final project-relative file;
- hash, dimensions, type, alternative text, and provenance;
- source brief and generation IDs;
- provider/model identifier when supplied;
- prompt hash and an immutable prompt record;
- selected page/slot relationship.

The raw prompt and provider metadata stay in the local project evidence area. Delivery manifests may include hashes and provenance summaries without exposing prompts by default.

### 3.6 Dual rendering

HTML and PPTX renderers must consume the same accepted `asset_id` from `asset_slots`.

- HTML embeds local images in its self-contained artifact.
- PPTX embeds raster images through native PptxGenJS image objects.
- `contain` preserves the full subject; `cover` uses a deterministic centered crop.
- generated text is never used as a substitute for editable PowerPoint text.
- a build fails when a referenced asset is missing, escapes the project root, or is not accepted when acceptance metadata is present.

## 4. Lifecycle and state

```text
Brief draft
  -> prompt ready
  -> generation queued
  -> generated
  -> automated validation
  -> visual observation pending
  -> user decision pending
  -> accepted | continued | rejected
  -> registered in page slot
  -> rendered in HTML and PPTX
```

A rejected generation remains in the audit trail. `continued` may create a reference edit. Repeated rejection for the same root cause must support a reconstruction decision rather than endless local prompt patching.

## 5. Data and persistence rules

The durable project directory remains the source of truth. SQLite may index state but cannot become a second authoritative model.

Required durable records:

- visual asset brief;
- compiled prompt and its SHA-256;
- generation attempt manifest;
- generated file and automated inspection;
- visual observation;
- user decision;
- accepted asset entry and page-slot selection.

Generated evidence belongs below `.pptops/visual-assets/`. Accepted deliverable assets belong below `assets/`. Paths must be project-relative, normalized, and unable to escape the project root.

## 6. Privacy, truth, and safety boundaries

- Source text is excluded from image prompts by default. Only the minimum accepted visual facts may be included.
- The system must not fabricate grades, transcripts, certificates, chats, dashboards, testimonials, student cases, or product data.
- If a real evidence image is required but unavailable, the brief must remain blocked or request an abstract illustration; it cannot ask ImageGen to imitate real evidence.
- Reference images are sent only when explicitly selected for that generation.
- Provider identifiers and outbound-field paths are auditable; secrets and authorization headers are never persisted.
- Existing accepted assets and delivered builds are immutable.

## 7. Non-goals for this increment

- a browser-based image editor;
- training or fine-tuning an image model;
- guaranteeing pixel-identical HTML and PPTX placement;
- automatic OCR quality equivalent to human review;
- automatic proof that a visual is aesthetically good;
- generating visual evidence that appears to document a real person or result;
- embedding live provider credentials in project files;
- replacing the existing Candidate, Version, Build, Review, or Handoff confirmation gates.

## 8. Observable acceptance criteria

1. A valid character brief compiles into the defined prompt sections and includes semantic action, composition, text policy, and avoidance constraints.
2. A reference-edit brief produces a provider request containing only explicitly selected references and records its parent/invariants.
3. Invalid briefs, unsafe paths, missing references, or unsupported outputs fail without creating an accepted asset.
4. Every generation attempt receives a stable ID, immutable manifest, prompt hash, output hash, and inspection record.
5. PNG transparency requirements fail when no alpha channel is present.
6. Visual observations and user decisions are separate records; automation cannot create user acceptance.
7. An accepted generated image can be selected through `asset_slots` and appears in both HTML and PPTX builds.
8. PPTX text remains editable and is not baked into the generated image.
9. The same accepted project version and build configuration produce stable asset selection and placement.
10. Tests cover fresh generation, reference edit, transparency failure, rejected visual observation, user acceptance, path escape, HTML rendering, PPTX embedding, and non-target page stability.
11. Existing projects without generated assets continue to validate and build.
12. Documentation provides one low-poly character example and one reference-edit example without requiring a live paid provider.

## 9. Completion claims

The increment may claim `Visual Asset Pipeline foundation complete` only after all automated acceptance criteria pass on the default branch.

It may claim `live ImageGen integration verified` only after a configured provider produces a real candidate and its request/response evidence is recorded.

It may claim `PowerPoint visual acceptance` only after the generated PPTX is opened and inspected in Microsoft PowerPoint. User/business acceptance remains a separate decision.
