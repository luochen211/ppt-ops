# Comprehension QA and acceptance

Comprehension QA is an advisory layer beside geometry, legibility, and human aesthetic judgement. Renderer observations and automated heuristics can identify missing label targets, connector mappings, three-second-message emphasis, image-region mappings, and distracting interaction cues. They do not prove audience comprehension.

Formal acceptance must record a named human decision against one exact build, Review report, and evidence hash. An `accepted` decision additionally requires an authorized real case; synthetic fixtures remain regression evidence only. Valid decisions are `accepted`, `changes_required`, and `inconclusive`.

Issue #114 stays open until an authorized real presentation has been reviewed and its human evidence is recorded. Passing automated checks alone is insufficient.

The Review and case evidence must explicitly reference the selected build, and the case evidence must reference the selected Review. Unassessed reports cannot receive formal acceptance. Renderer collectors preserve declared message alignment, image-region counts, and decorative-overlap signals so these heuristics operate on the collected observations.
