# Native acceptance audit — 2026-09-10

This is an agent-operated Computer Use audit of the remaining acceptance work in #45, #52, #69 and #21, against main `7993cfd`. It records application observations and actual generated-image evidence. It is not a human visual decision, business sign-off, target-user trial, or authorization to create a GA release.

## Results

| Issue | Verified in this audit | Outstanding acceptance |
|---|---|---|
| #45 | The three exact Candidate PPTX files opened in Microsoft PowerPoint; pages 16, 31 and 49 were visibly inspected. Their original hashes matched. Observations were recorded and each Candidate is now awaiting a user decision. | Actual user feedback and a repeated-root-cause reconstruction cycle on the real project. The agent found weak relation mapping: the proposed causal, diagnostic and decision relationships remain card layouts. These findings are not fabricated user rejections. |
| #52 | Two real ImageGen outputs were prepared and generated for separate first/final page briefs, ingested unchanged, and passed raster and agent visual checks. | Explicit acceptance of each image, registration, common-identity HTML/PPTX build and exact built-artifact PowerPoint inspection. These downstream steps remain gated while user decisions are pending. |
| #69 | Live GitHub was checked: no open PR; the claimed contributor branch was not retrievable from the contributor fork (HTTP 404). Current main has no delivery-selection workflow. | A reviewable implementation is required. This audit does not override the contributor's claim or infer its abandonment. |
| #21 | The real 54-slide RC opened in PowerPoint. An independent copy was used to copy a native object, edit its text, save, enter slideshow, advance pages, reach slide 54 and return to the editor. Source bytes remained unchanged. | Named human visual/manual acceptance, full font-substitution sign-off, accepted delivery package, and three distinct target-user trials without modifying code. |

No Issue in this table is closed by this audit.

## Exact 67-slide Candidate evidence

The project is `acceptance/v1-67-slide-loop-20260902` in the maintainer's local workspace. Full screenshots and persisted observations remain local under its `acceptance/computer-use-20260910/` directory rather than publishing private presentation content.

| Candidate | Target page | PPTX SHA-256 | Recorded state |
|---|---:|---|---|
| candidate-001 | 16 | `dd381ec80daffca467374538e20b2fd49909ca6727831e24aa24476d4f805ca2` | awaiting_user_decision, revision 5 |
| candidate-002 | 31 | `8e7e8da2336868193a6d79e9fddc8cdf78e4c09744f759ea3ffa927642ac883f` | awaiting_user_decision, revision 5 |
| candidate-003 | 49 | `4384f05d0b3d03486c4b4cc3e035845f1d136ea9ad0ed7b21986df0b052f550e` | awaiting_user_decision, revision 5 |

The immutable observations explicitly name `observer: agent` and `method: Computer Use GUI`. `pages.json` stayed at SHA-256 `421b9c5cec96236303e8828b3de3850392b2bd01420e6402f115ccce67d1bb5c`.

Comparing all 67 slide XML parts between candidates 001/002 found differences only on pages 16 and 31; comparing 001/003 found differences only on pages 16 and 49. Thus the distinct target candidates did not introduce unrelated slide changes. This proves Candidate isolation, not post-acceptance Draft mutation, since none was accepted.

## Actual generated boundary images

The local project is `acceptance/live-boundary-20260910`. Both prompts, original images, generation records and agent observations are retained in its `.pptops/visual-assets/` directory. The model identifier is recorded as `not-exposed-by-tool`; a specific underlying model is not invented.

| Role | Generation ID | SHA-256 | Observation |
|---|---|---|---|
| First page | `visual-generation-247ea60c-a507-4b84-957c-b9dc4d30dcc5` | `eca256b799e74a5deb660cfd2ea7f33a2b244e63b091d9ad924112121f227062` | One non-identifiable adult arranges three blank cards; left copy space remains clear. |
| Final page | `visual-generation-a4d4af4c-97d7-40eb-a7fd-52853c6e2f9d` | `f9d35fcac90c6e3cf1c7bdd6c48466df3af97472a844e3df3acf5e0bb7034866` | Two non-identifiable adults hold opposite sides of one unmarked folder during handoff. |

Both are untouched 1672 × 941 PNG results from the built-in ImageGen tool. Signature, MIME, dimensions and ratio checks passed. The agent inspected subject count, action, identity, text/logo contamination, edges and copy-safe space. There are no user decisions or accepted registrations yet. Copies were placed on the maintainer's Desktop for review.

## 54-slide RC native operations

- The immutable source remains SHA-256 `ba15e9359f308c9b8bbbe8e6fec2138942e65a678a6daf17722d3994b0b2a42e`.
- The separate working file is `acceptance/computer-use-20260910/rc-54-edit-test.pptx`; it is a test copy, not a reviewed replacement build.
- Copy/paste increased native shape count on slide 2 from 10 to 11. The duplicated title was individually selectable in the application.
- The duplicate's text was edited to `Computer Use edit test`, saved in PowerPoint and confirmed in the resulting slide XML. Original source text remained in the original object.
- The saved test copy hash at inspection was `c9400970d1c2d4697b402c3599a791c426cf824ce995bc90f254522394948ccf`.
- Slideshow was observed on pages 2, 3 and 54. The next-page control, last-page jump and exit-to-editor behavior worked.
- Chinese and Latin text was readable in the inspected native frames. Selecting a title exposed `Aptos Display`, 28 pt. This does not prove absence of font substitution throughout the deck. The source declares Aptos and Aptos Display; Office bundles Aptos locally, while the system font inventory alone does not establish Office's private/cloud font availability. Full font sign-off remains pending.
- This older RC also predates the current mandatory generated-boundary policy. Its operation checks cannot establish compliance of a current formal delivery.

Local screenshots and `rc-observation.json` are under `acceptance/computer-use-20260910/`. All original RC and Candidate presentation files were preserved.

## Automated checks and release decision

The 23 focused application, five-round feedback/reconstruction, large-deck, release-readiness, infrastructure and update tests passed on the current implementation. The last main CI before this documentation change passed all 170 tests plus HTML QA, example validation and boundary/integration checks.

`node scripts/check-release-readiness.js` returned `ready: false`. Human visual, manual PowerPoint, delivery-package and all three target-user records remain incomplete. The non-zero result is the expected enforcement of the release gate, not permission to fill in missing evidence. No GA tag or release was created.

The next user decisions are concrete: feedback on the three displayed native Candidate pages, and acceptance/iteration/rejection of the two generated boundary images. Independent target-user trials still need actual participants following [the trial protocol](../target-user-trials.md).
