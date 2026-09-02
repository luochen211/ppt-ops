# V1 Release Candidate Acceptance Record

Recorded on 2026-09-02 for Issue #20. This record separates automated evidence from human, real-device, and business acceptance. It does not authorize a V1.0 GA release.

## Release-candidate result

| Area | Status | Evidence |
|---|---|---|
| Five standard conversations | Passed (automated) | `test/golden-conversations.test.js` covers topic-only creation, DOCX intake, existing-PPTX restructuring, target-page revision, and Review/Handoff. |
| Real 50+ slide project | Passed (automated) | The archived `顶峰开班直播-累计工作版-01-54.pptx` produced 54 PageSpecs, an immutable Version, a successful editable PPTX Build, and Review evidence. |
| Microsoft PowerPoint render | Passed (automated application interaction) | Microsoft PowerPoint opened the generated 54-slide PPTX and exported a 54-page PDF; `pdftoppm` produced 54 PNGs and ImageMagick produced a montage. This is not manual PowerPoint acceptance. |
| PPTX structure and visual-risk checks | Passed (automated) | All 54 pages were checked for bounds, unintended overlap, declared fonts, and density; zero findings were reported. |
| Performance baseline | Passed (observed baseline) | Total 18,875.17 ms; freeze 10.76 ms; PPTX build 58.62 ms; PowerPoint render and Review 18,614.83 ms on the recorded local Mac. The repeatable synthetic 52-slide test has a 30-second ceiling. |
| Privacy boundary | Passed (automated) | `test/ai-pipeline.test.js` verifies allowlisted payloads, default exclusion of private source text, scoped authorization, sanitized errors, and HTTPS provider configuration. |
| Malicious and invalid input | Passed (automated) | `test/source-intake.test.js` rejects forged MIME, ZIP traversal, per-entry overflow, and expanded-archive overflow. |
| Path and layer boundary | Passed (automated) | `test/data-contract.test.js` and `test/update.test.js` reject absolute/parent escapes, user/project-layer mutation, symlinks, and incompatible updates. |
| Failure recovery and retry | Passed (automated) | `test/infrastructure.test.js` preserves attempts, recovers interrupted work, persists cancellation, and keeps immutable evidence; `test/update.test.js` proves rollback after failed post-update Doctor. |
| Concurrency | Passed (automated) | `test/infrastructure.test.js` verifies concurrent builds use isolated immutable artifact paths; PowerPoint rendering is serialized with a bounded cross-process lock. |
| Human visual acceptance | Pending | The montage exists for inspection, but no human acceptance record has been entered. |
| Manual macOS PowerPoint acceptance | Pending | Copy-object, edit-text, slideshow playback, and font-substitution checks still require a named human record. |
| Chrome and Safari HTML artifact checks | Pending | HTML is an optional artifact, not a product interface. Browser interaction acceptance has not been recorded. |
| Independent target-user trials | Pending | This belongs to Issue #21 and requires three real target users; no automated result may substitute for it. |

## Reproducible commands

Run the full automated suite:

```sh
npm test
```

Run the deterministic synthetic 50+ slide gate:

```sh
node --test test/v1-release-candidate.test.js
```

Run a real local deck through import, migration, freeze, build, Review, and optional PowerPoint rendering:

```sh
node scripts/run-large-deck-acceptance.js INPUT.pptx NEW_PROJECT_DIRECTORY --render
```

The destination must be new or empty. The command records `acceptance/large-deck-report.json` inside the generated project and fails if fewer than 50 slides contain extractable text.

## Recorded real-project evidence

- Source SHA-256: `3cbcaaef2ada993a51e6c6401d67f1f6118bddc05fdb4d651d185d4d31a28f82`
- Extracted slide count: 54
- Version snapshot SHA-256: `476506efe5734074314e0f67a8faf13463d4816a573f135312c1718d6a0eef8f`
- Generated PPTX SHA-256: `ba15e9359f308c9b8bbbe8e6fec2138942e65a678a6daf17722d3994b0b2a42e`
- Local evidence root: `/Volumes/Luochen/ppt生成/acceptance/v1-rc-50-slide-20260902-r2`
- Desktop montage: `/Users/luochen/Desktop/ppt-ops-v1-50-slide-montage.png`
- Review state: `human_pending`; required automated checks passed.

The first real-project attempt failed at the layout-capacity gate because a migrated page had four body items while the selected template permits three. The migration policy was corrected to retain at most three body items, a five-item source fixture was added, and the clean rerun passed. This failure remains an example of an actionable stage-specific error rather than a silent layout degradation.

## Flaky-test record

No test was observed to fail nondeterministically in the recorded 86-test full-suite run. External PowerPoint rendering is deliberately excluded from normal CI, serialized locally, bounded by `PPT_OPS_RENDER_TIMEOUT_MS` (60 seconds by default), and reported as degraded rather than as a false pass if the external application is unavailable or times out.

## Blueprint boundary

Sections 14.1-14.3 have automated and real-project evidence sufficient for the T8 integration gate. The unresolved items above remain explicitly pending under section 14.4. Therefore this record supports moving to documentation and user acceptance, but it does not support claiming that V1.0 is complete or creating a GA tag.
