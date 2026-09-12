# Governed citations

- Offer citation delivery only when the selected Frozen Version contains an accepted fact ledger.
- Ask the creator to choose `on_slide`, `speaker_notes`, `appendix`, a combination, or `internal_only` before Build.
- Require explicit public metadata and disclosure authorization. Never expose a local path, private URL, excerpt, organization name, author, title, date, or locator by default.
- Missing metadata stays pending. Never invent bibliography fields.
- Treat citation completeness, source integrity, and fact validity as separate checks.
- If an on-slide citation region exceeds capacity, stop for a layout or channel decision; do not silently shrink or overlap text.
- Existing projects without a ledger or citation choice retain current behavior.

Implementation and CLI example: `docs/governed-citations.md`.
