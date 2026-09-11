# User-selected delivery formats

New projects omit `Project.outputs`. Outline and Design can proceed before any export choice. Older project files with `outputs` remain readable, but that field never authorizes a new delivery. No format is silently selected.

At Handoff, offer the available self-contained HTML, editable PowerPoint and PDF choices. At Outline acceptance, independently offer Markdown, Word and PDF; the user can also continue without exporting the outline. Use plain language and keep commands out of the conversation.

## Presentation delivery

Create explicit immutable Build targets from a Frozen Version and review the exact Build. `delivery-capabilities` reports which artifacts are available. HTML and PPTX are independent renderers; neither is a conversion source for the other. A format absent from the Build requires another explicitly requested Build from the same Frozen Version and its own Review.

Use `delivery-select --artifact presentation --formats pptx --source <build> --source-revision <version> --build <build> --actor user`, then pass its stored ID to `handoff-create --selection <id>`. Handoff requires the accepted Review, matching source hashes and an explicit stored user decision. It packages only selected files plus the Review report and manifest. Caller-supplied selection JSON cannot replace the stored evidence.

PDF becomes available only when a reviewed source and exporter exist. A reviewed HTML source uses Chromium printing with one page per slide and notes/navigation hidden; otherwise a reviewed PPTX can use the native presentation converter. The derivative records the source file hash, Build/Version, Review, exporter and output hash. PDF-only delivery does not add the unselected source file to the package. Failed exporters report `EXPORTER_UNAVAILABLE`, preserve accepted work and allow reselection; they never silently switch formats. Existing immutable derivatives are reused only after their hashes are verified.

## Outline delivery

`outline-source` returns the outline identity and hash of its title, sections and referenced page content. After explicit acceptance, `outline-approve --source-revision <hash> --actor user --raw-feedback <text>` preserves the exact accepted snapshot. A later change requires a new acceptance.

`delivery-select --artifact outline --formats markdown,docx --source <outline> --source-revision <hash> --approval <id> --actor user` exports only the selected formats. Markdown and editable DOCX are produced directly from the accepted snapshot. PDF uses an internal print document derived from that snapshot, with its hash and approval preserved in `pdf-source.json`. Chromium availability is reported before selection; its failure cannot discard accepted content. Outline exports do not create a presentation Build or pretend to satisfy presentation Review.

## Durable evidence and reselection

Each choice is a new immutable `.pptops/delivery-selections/<id>/manifest.json` containing artifact type, formats, source identity/revision, user actor, decision time and choice source. Outline choices also reference an immutable `.pptops/outline-approvals/<id>/manifest.json`. These files survive database reindexing. Reselection does not modify previous choices, accepted content, PageSpecs, frozen Versions or Builds. Export manifests include output hashes and errors retain the selection ID.

The older `handoff` and `deliver` convenience commands now require `--formats html,pptx --actor user`. They record an explicit choice and a hash of the current output snapshot, and package only selected outputs. Their separate visual/PowerPoint acceptance remains pending unless independently performed; use formal Build/Review/Handoff commands for an accepted delivery. Existing packages remain untouched. The former implicit `Project.outputs` default is removed.
