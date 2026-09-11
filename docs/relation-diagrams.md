# Authored relation diagrams

A PageSpec may opt into `diagram` with 2–12 authored nodes and 1–16 directed edges. Each node has a stable `id`, visible `text`, a semantic `role` (`input`, `process`, `output`, `condition`, `evidence`, or `context`), and normalized `x`, `y`, `w`, `h` within the content region. Edges reference existing node IDs using `from` and `to`, with optional `from_side`, `to_side` and a short visible `label`.

Use this for source-supported causal chains, diagnostic branches and conditional decisions. Keep independent source items distinct. An authored graph replaces body cards on that page; leave `screen_text.body` and `asset_slots` empty. The title remains native text. Conditions render as diamonds; other roles use text with restrained baselines. PPTX text, shapes and arrows remain independently editable. HTML uses DOM text and SVG connectors.

The graph is opt-in; existing pages keep their current renderer. Coordinates describe a visual hypothesis, not new source facts or proof of acceptance. Render an isolated Candidate and inspect the exact PPTX in Microsoft PowerPoint before requesting a user decision. Continue/reject/accept and repeated-root-cause reconstruction remain governed by the existing Candidate state machine. Adding a graph cannot accept or freeze a page.

Runtime validation rejects duplicate IDs, dangling or self edges, invalid roles/sides and out-of-bounds nodes. Renderer tests check native editable text/arrows, escaping, and unchanged non-target slide XML under the same renderer version. Native visual review remains necessary for text fit and connector clarity.
