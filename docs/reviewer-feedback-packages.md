# Non-technical reviewer feedback packages

PPT-Ops can turn one existing HTML Build and its matching Review into a portable folder for a sponsor, subject-matter expert, client, executive, or brand reviewer. The reviewer opens `index.html`, reads the scope and requested decisions in plain language, reviews every slide, and downloads a JSON response to return to the creator. The folder works offline and makes no network or telemetry requests.

This is a bounded review artifact, not a hosted collaboration product or Web Workbench. It never rebuilds the presentation, edits an accepted PageSpec, changes a frozen Version or Build, advances the Review, or creates a Handoff.

## Creator flow

The `$ppt-agent` conversation remains the user interface. Before creating a package, the Agent collects:

- purpose, audience, and the exact review scope;
- one or more plain-language decisions or questions;
- a change summary and optional deadline;
- an explicit yes/no choice for speaker notes, source citations, and earlier reviewer feedback.

All three disclosure choices are required even when every answer is `false`. Sensitive context is never included by omission or default.

The underlying application command is:

```sh
pptops review-package-create <project-dir> \
  --build <build-id> \
  --review <review-id> \
  --brief '{"purpose":"Confirm the launch story","audience":"Executive sponsor","scope":"Message and launch decision","requested_decisions":["Can this deck be used at launch?"],"change_summary":["The opening now leads with the audience outcome."],"deadline":"2026-09-15","disclosures":{"speaker_notes":false,"sources":false,"prior_feedback":false}}'
```

The first slice intentionally requires the selected Build to contain `html/slides.html`. If it does not, package creation returns `REVIEW_PACKAGE_HTML_BUILD_REQUIRED`; it does not silently render a new presentation from the frozen source.

The HTML bytes must still match the selected Review. Every disclosure choice is checked against the packaged deck before any package files are written. A Build containing excluded speaker notes or other known excluded context returns `REVIEW_PACKAGE_DISCLOSURE_UNSAFE`. Select an already reviewed artifact without that context, or explicitly include it. The packager never removes content from or rebuilds the immutable artifact.

## Package contents

- `index.html`: the plain-language entry, fixed slide previews, review form, and offline response download;
- `deck.html`: an exact byte-for-byte copy of the selected immutable HTML Build artifact;
- `response-template.json`: a portable response template bound to this package;
- `manifest.json`: Build and Review identifiers, revisions and hashes, page mapping, disclosure decisions, artifact hashes, creation time, review scope, and the acceptance boundary.

The entry page identifies slides as `Slide 1`, `Slide 2`, and so on. Internal PageSpec IDs remain in the technical manifest so an imported response maps reliably back to the reviewed Build without exposing repository paths or commands in the reviewer-facing page.

The package identifier is derived from the immutable Build/Review binding and normalized review brief. Repeating the same request reuses the existing package; changing the brief or disclosures creates a different non-overwriting package.

## Reviewer response and import

The reviewer may provide a deck-level or slide-level `approve`, `request_changes`, or `comment` decision. Comment text is retained verbatim. Name, role, contact, and decision time are stored only when the reviewer supplies them, and identity is always recorded as unverified in this slice.

The creator imports the returned file through the Agent. The underlying command is:

```sh
pptops review-package-import <project-dir> --response <review-response.json>
```

Import validates the opaque package binding, checks every human-facing slide reference against the manifest, writes the original response and a portable manifest as immutable evidence, and appends a `reviewer_feedback` record. `reindex` can restore that evidence after rebuilding local metadata. It never changes the selected Review or any presentation artifact.

- If a newer succeeded Build exists, the response is preserved with `stale: true` and records the current Build ID for comparison.
- Responses from different reviewers remain separate. Opposing `approve` and `request_changes` decisions for the same deck or slide are returned as conflicts for the creator to resolve.
- `comment` is not approval. An opened package, a blank response, silence, or free-form comments without an explicit approval decision never become approval.

## Accessibility and security boundary

The entry uses semantic headings, labelled fieldsets and controls, visible keyboard focus, high-contrast defaults, responsive sizing, and reduced-motion styling. The manifest calls this `baseline_applied`; it does not claim an external accessibility audit.

The package uses a restrictive Content Security Policy and contains no network code. It excludes raw prompts, provider logs, local paths, secrets, and source contents. When source disclosure is enabled, the entry shows numbered citation locators rather than source file paths. Other reviewer-facing export formats remain governed by the delivery/export capability boundary and are not simulated here.
