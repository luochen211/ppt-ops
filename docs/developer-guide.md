# Developer Guide

## Contract and state boundaries

V1 contracts live in `schemas/v1/` and runtime semantic validation lives in `src/contracts/v1.js`. Project, Source, Outline, PageSpec, Theme, Template, Asset, Candidate, Approval, Version, Build, Review, and Handoff entities carry `contract_version`, `kind`, and stable `id`. State transitions are centralized in `src/core/state-machines.js`.

JSON contracts and project files are portable truth. SQLite stores rebuildable indexes, revisions, queue state, attempts, and events. Application commands must go through `ApplicationService`; Skills and adapters must not patch SQLite directly.

## Application and local API

`src/application/service.js` owns candidate proposal, isolated Candidate preview rendering, PowerPoint observation, explicit accept/continue/reject decisions, feedback and attempt inspection, forced semantic reconstruction, Version freeze, Build creation/retry, Review run/record, and Handoff creation. `candidate-render` writes an immutable preview under `.pptops/candidates/` from an in-memory patched snapshot and leaves the Draft unchanged; PowerPoint evidence must match its artifact hash and pages. Candidate feedback stores raw language plus atomic `findings[]`; every finding separates `eval_category` from `root_cause` and carries target, evidence, severity, and a root-cause fingerprint. `layout_composition` covers spatial integrity independently from hierarchy and brand fit. A second user rejection with any matching finding fingerprint forces reconstruction. Automated QA rejection is evidence-bearing but never counts as user feedback. Commands use stable JSON success/error envelopes. The loopback-only API in `src/infrastructure/local-api.js` exposes project and task evidence without becoming a Web product interface.

## Templates and renderers

Add semantic templates in `src/layout/catalog.js`, including explicit capacity rules and renderer mappings. Both HTML and PPTX must consume the same PageSpec meaning and deterministic Layout Plan. Add fixtures for both renderers and reject over-capacity content rather than silently shrinking it.

Screenshot assets may opt into evidence semantics and presentation-scale composition checks. See [Screenshot evidence QA](screenshot-evidence-qa.md). These automated checks must stay separate from human readability and real PowerPoint acceptance.

## Delivery semantics

`Project.delivery_mode` is optional for backward compatibility and accepts `live_talk`, `workshop`, `pitch`, `leave_behind`, or `async`. Optional PageSpec delivery metadata includes `estimated_duration_seconds` (a planning estimate, not rehearsal evidence), `speaker_note_intent`, and `audience_interaction`. `speaker_note_intent` describes off-slide support; it is not visible copy. Renderers must never place it or interaction metadata into slide shapes or HTML slide content. Authored `speaker_notes` are exported to native PPTX notes and an independent HTML `?view=notes` view; the default slide view hides them. Intent remains planning metadata and is never substituted for authored notes. Mode-aware review guidance lives in `src/contracts/delivery.js`; legacy projects without a declared mode retain the original density limits.

## Provider adapters

Provider adapters implement the neutral interface consumed by `src/ai/pipeline.js`. They must use HTTPS, a bounded timeout, structured output, retry classification, and sanitized errors. Payload construction is allowlist-based; raw source content is excluded unless the caller explicitly authorizes selected segments. Add payload and non-target-mutation regression tests for every adapter.

## Mandatory boundary visuals

`src/visual-assets/boundary-policy.js` is the fail-closed policy for formal deck boundaries. It uses canonical V1 PageSpec order, not names or filenames. A passing asset must resolve through the Visual Asset Pipeline's immutable brief, prompt, generation, inspection, observation, user decision, registration, and current file hash. Keep draft validation separate: it must still work before images are ready, while Version freeze, Build, Review, Handoff, and delivery must reject missing or contradictory evidence with `BOUNDARY_IMAGE_REQUIRED`.

Tests may use deterministic raster fixtures to exercise the contract, but those records never establish live ImageGen, human aesthetic, Microsoft PowerPoint, or business acceptance. Do not add a Foundation formal-build bypass or accept `type: image` as an equivalent boundary asset.

## Required checks

```sh
npm ci
npm test
npm run check
node scripts/check-release-readiness.js
```

The final command is expected to fail while human or target-user evidence is pending. Do not weaken it to make a release pass.

## System distribution

`npm run package:update` creates `dist/ppt-ops-system.tar.gz` and its SHA-256 sidecar from committed `HEAD`. It includes only tracked paths from `SYSTEM_PATHS`; uncommitted changes and user/project files are excluded. CI runs the updater regression suite on Linux and macOS, then builds, extracts, installs, and checks the system package before uploading it as an artifact. GA release attaches the same system package in addition to the full source archive, after the existing acceptance gate passes.

`update.mjs` resolves the latest successful main push CI run through GitHub's API and fetches the exact SHA. It does not move the installation's Git branch, index, or HEAD. File manifests track installed content across repeated updates; initial conflict detection uses the installation's committed System Layer snapshot. See [System updates](system/updates.md).
