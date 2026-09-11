# Relation reconstruction and release preparation — 2026-09-11

Agent-operated Microsoft PowerPoint observations on the real 67-page acceptance project. These are application observations, not user aesthetic/business approval or independent user trials.

| Page | Current Candidate | Native observation (Asia/Shanghai) | Exact PPTX SHA-256 |
| --- | --- | --- | --- |
| 16 | candidate-004 | 10:07:08; three separate causal chains, readable text and arrows | 169336a9d943a8805e7bc32052cd9188896ed19cfde9123e9d2cc6ba3323b001 |
| 31 | candidate-005 | 10:09:14; shared symptom branches into external/internal diagnosis and actions | f0db7395a131b6caf0f36d4654b885c85b810f59abf29426e179ed4e51a5cdb8 |
| 49 | candidate-007 | 10:12:10; explicit conditional gate and two results; balanced line breaks | 0b15d3547755680b702f03394bc03cb6a17297dc16d115c80402a6b22b35a712 |

Candidate-006 is preserved and rejected by Agent QA because the native renderer wrapped a question mark onto a separate line. Candidate-007 corrects authored line breaks. This is not a user rejection and does not satisfy repeated-user-root-cause acceptance criteria.

The maintainer's earlier continuation is preserved as `continue_iteration`. Candidates 004, 005 and 007 have exact-artifact PowerPoint observations and await a user decision. No target page was applied to the Draft, and no acceptance was invented.

Canonical `pages.json` remains SHA-256 `421b9c5cec96236303e8828b3de3850392b2bd01420e6402f115ccce67d1bb5c`. For each current Candidate, comparison against the canonical Draft rendered by the same current renderer found exactly one changed slide XML (16, 31 or 49 respectively) and 66 unchanged slide XML parts. This comparison does not claim identical rendering across historical renderer versions.

Private evidence remains under the local acceptance project's `acceptance/reconstruction-20260911/`: per-Candidate native screenshots, current-renderer baseline, isolation results and persisted application observations. Private source slides are not committed.

Validation: 186 automated tests passed, including editable native text/arrows, diagram contract failures, HTML escaping and non-target slide preservation. Native visual observations cover the three named pages. They do not certify the complete 67-page source or font substitution on other machines.

For #21, installation/upgrade/backup/recovery/troubleshooting, developer documentation, demo, release automation and release notes already exist. A copyable [independent trial record](target-user-trial-template.md) now covers explicit output selection, outline approval, native editing/fonts, exact-artifact review and selected-only handoff. Release readiness remains false for human visual/manual PowerPoint/delivery-package sign-off and the three actual participant trials. No GA release was dispatched. The historical #45 requirement for actual repeated-root-cause user rejection remains unevidenced, regardless of the issue's current GitHub closure state.
