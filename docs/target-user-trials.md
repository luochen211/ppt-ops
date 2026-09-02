# Target-User Trial Protocol

Three independent target users must each complete the same core job without changing repository code. Use pseudonymous participant IDs; do not commit names, contact details, source documents, secrets, or private presentation content.

## Trial task

1. Start from the documented installation and `$ppt-agent` conversation entry.
2. Import a participant-appropriate Markdown, DOCX, or PPTX source.
3. Inspect source extraction and references.
4. Confirm or revise Outline and PageSpecs through conversation.
5. Freeze a Version and build editable PPTX output.
6. Inspect the rendered slides and manually test opening, copying an object, editing text, slideshow playback, and fonts in macOS Microsoft PowerPoint.
7. Create and inspect the Handoff package without modifying code.

## Evidence record

Create one Markdown record per participant outside the repository while it contains private details. Commit only a redacted record that includes:

- pseudonymous `participant_id`;
- target-user profile category;
- UTC start/completion timestamps;
- source type and non-sensitive project size;
- commands or Agent milestones reached;
- Build, Review, and Handoff IDs/hashes;
- manual visual and PowerPoint results;
- whether any code was modified (must be `false`);
- blockers and observed failures;
- participant completion decision.

After the record is reviewed, update the corresponding slot in `docs/acceptance/v1.0-matrix.json` to `passed`, set `code_modified` to `false`, add the completion timestamp, and link the committed redacted evidence. All three participant IDs must be distinct.

Run `node scripts/check-release-readiness.js`. A zero exit code means the recorded gates are structurally complete; it does not verify that evidence is truthful. The maintainer must review the underlying records before dispatching the GA workflow.
