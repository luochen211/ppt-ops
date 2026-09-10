# User-approved visual preferences

PPT-Ops may learn reusable visual preferences only through an explicit, inspectable user decision. This first phase provides a user-layer profile store and domain workflow; it does not scan historical projects or extract a reference deck automatically.

The profile lives at `config/visual-preferences.json`, beside the user-owned profile configuration. System updates must never overwrite it.

## Evidence and consent model

1. A user explicitly nominates a reference deck by stable ID, safe relative path, and SHA-256 digest. Nomination records metadata only; it does not authorize scanning unrelated files.
2. An agent may record observed visual properties and propose a separate inferred preference or anti-pattern.
3. A proposal is not available to later projects until the user explicitly accepts it.
4. Two distinct user rejections with the same `aesthetic_brand` root-cause fingerprint may propose a candidate. Repetition still cannot accept it.
5. Revision creates a new proposed candidate and supersedes the old one. Removal marks an accepted preference removed without erasing its audit history.

Only `VisualPreferenceProfileStore.accepted()` is a design input. Proposed, rejected, removed, and superseded candidates are evidence, not active instructions.

## Current boundary

This phase implements nomination, proposal, consent, revision, removal, atomic persistence, and retrieval of accepted preferences. Reference-deck content extraction, CLI commands, a conversational confirmation surface, and automatic Design-mode loading remain future work under issue #64.
