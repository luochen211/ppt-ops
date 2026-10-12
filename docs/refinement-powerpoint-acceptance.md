# PowerPoint refinement acceptance

Stage 5 does not treat an OOXML test fixture or an HTML preview as proof that a refined deck works in Microsoft PowerPoint. Before an `accept` decision can produce a versioned delivery, a named human must record one real-presentation round trip against the exact Candidate hash.

Required evidence:

- `application` is `Microsoft PowerPoint`.
- `real_presentation` is `true` and `case_id` identifies the authorized case.
- `actor` identifies the human reviewer.
- `steps.opened`, `steps.edited`, `steps.saved`, and `steps.reopened` are all `true`.
- `candidate_id` and `candidate_sha256` match the reviewed Candidate.

Example:

```json
{
  "candidate_id": "refinement-example",
  "candidate_sha256": "<sha256>",
  "application": "Microsoft PowerPoint",
  "real_presentation": true,
  "case_id": "authorized-client-deck-2026-10",
  "actor": "user:reviewer",
  "steps": { "opened": true, "edited": true, "saved": true, "reopened": true },
  "notes": "Target objects remained editable; unsupported objects were preserved."
}
```

This record confirms application-level interoperability. It does not expand the approved Scope or authorize content changes.
