# Audience variants

Load `variants.json` only when the user names a variant, asks for multiple audience/time versions, or a shared change has variant impact. Resolve the requested variant from its shared base and sparse overrides; never copy the entire project to simulate inheritance.

Ask whether a change belongs to the shared base, one named variant, or selected variants. A variant-local change must not affect its base or siblings. After a shared change, report affected inherited pages, overridden pages, and stale frozen outputs. Do not adopt the change into an accepted or frozen variant without a reviewable Candidate or explicit rebase decision.

Describe variants by audience, purpose, duration, and delivery mode. Keep internal inheritance and storage details hidden unless the user asks.
