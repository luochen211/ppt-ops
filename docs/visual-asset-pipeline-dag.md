# Visual Asset Pipeline Delivery DAG

> Source of truth: `docs/visual-asset-pipeline-requirements.md`
>
> GitHub Epic: [#50](https://github.com/luochen211/ppt-ops/issues/50)
>
> Planning baseline: 2026-09-02, `origin/main` at `c3a42d1`

## 1. Next goal

Make ImageGen an enforceable boundary of every delivered deck: the first and final page must each use a pipeline-registered generated image with intact automated, visual, and user-acceptance evidence before the project can freeze, build, review, hand off, or deliver.

The goal is complete at two different evidence levels:

1. **Foundation complete**: provider-neutral code, deterministic fake-provider tests, immutable local records, registration gates, dual rendering, Agent instructions, merged PR, and green CI. Completed by #51.
2. **Boundary enforcement complete**: first/final generated-image evidence is checked fail-closed at every formal lifecycle boundary. Owned by #58.
3. **Live acceptance complete**: two real ImageGen results are accepted for a multi-page deck's first/final pages, rendered through the exact path, and inspected in Microsoft PowerPoint. Owned by #52.

These levels may not substitute for one another.

## 2. Dependency graph

```text
#51 Implement the Visual Asset Pipeline vertical slice
  |
  v
#58 Require accepted ImageGen visuals on first and final pages
  |
  v
#52 Validate a live generated visual in Microsoft PowerPoint
  |
  v
#50 Epic: deliver the Visual Asset Pipeline
```

| Issue | Queue rule | Deliverable | Completion boundary |
|---|---|---|---|
| [#51](https://github.com/luochen211/ppt-ops/issues/51) | Done | Complete provider-neutral vertical slice | Code, tests, PR, default-branch CI |
| [#58](https://github.com/luochen211/ppt-ops/issues/58) | Depends on #51 | Mandatory first/final generated-image policy and lifecycle gate | Focused/full tests, PR, default-branch CI |
| [#52](https://github.com/luochen211/ppt-ops/issues/52) | Depends on #58 | Two live boundary generations and exact-artifact PowerPoint observation | Real provider and Microsoft PowerPoint evidence |
| [#50](https://github.com/luochen211/ppt-ops/issues/50) | Parent | Epic audit and closeout | #51, #58, and #52 all Done |

## 3. Why the implementation is one vertical node

The provider-neutral visual pipeline is already merged under #51. Issue #58 now owns the smallest coherent enforcement boundary: evidence resolver, lifecycle gates, Agent instructions, and regression coverage. Live provider and PowerPoint truth remain in #52 because a green deterministic test cannot establish that external acceptance evidence.

## 4. Issue #58 implementation plan

### A. Boundary evidence resolver

- Resolve first/final pages from canonical page order; deduplicate a one-page deck while retaining both semantic roles.
- Require a selected `generated_image` asset in a boundary page slot.
- Verify the accepted asset bytes and provenance against the immutable generation manifest, inspection, visual observation, user decision, and registration records.
- Return role, page id, and first actionable evidence gap for every failure.

### B. Fail-closed lifecycle wiring

- Keep intake, outline, design, edits, and draft validation available while images are pending.
- Block version freeze, formal HTML/PPTX build, Review, Handoff, and delivery before renderer or artifact mutation.
- Re-evaluate evidence at every formal boundary so deleted or contradictory evidence cannot inherit an earlier pass.
- Do not add a warning mode, legacy formal-build bypass, or static-image substitution.

### C. Agent workflow

- Make first/final ImageGen work explicit during design.
- Prevent build/review/handoff routes from claiming readiness until both exact candidates pass observation and explicit user acceptance.
- Keep real ImageGen and Microsoft PowerPoint evidence in #52 rather than simulating it in #58.

### D. Verification

- Cover both missing, one missing, static asset, forged provenance, valid multi-page, valid one-page, and contradictory/deleted evidence.
- Assert both HTML and PPTX resolve the same verified boundary asset identity.
- Run focused tests, the full suite, project review, and `git diff --check`.

## 5. Conflict and file ownership

Issue #58 may change:

- the boundary policy below `src/visual-assets/**`;
- minimum lifecycle and CLI wiring needed to enforce it;
- `.agents/skills/ppt-agent/**`;
- focused tests and Visual Asset Pipeline documentation.

It must preserve:

- the Candidate rejection/reconstruction state machine in #45;
- existing source intake and migration behavior;
- accepted assets and delivered build immutability;
- unrelated user work in the main worktree, including the untracked `acceptance/` directory.

## 6. Deterministic test matrix

| Scenario | Expected evidence |
|---|---|
| Fresh character generation | Structured prompt, immutable attempt, output hash and dimensions |
| Reference edit | Exact reference hash, parent generation, change scope, invariants |
| Non-alpha PNG with transparency required | Automated validation fails; no user-accept state |
| Rejected visual observation | Observation persists; registration forbidden |
| Explicit user acceptance | Separate decision record; registration becomes legal |
| Escaping source/output path | Operation fails before project mutation |
| Duplicate asset id or destination | Atomic failure; existing bytes and JSON unchanged |
| HTML build | Accepted asset is embedded by selected asset id |
| PPTX build | Same asset is embedded as an image object; text remains native |
| Legacy or new project without generated assets | Draft validation remains valid; freeze/build/review/handoff/deliver fail closed |
| Multi-page, first accepted only | Final page id and evidence gap reported |
| Multi-page, first and final accepted | Freeze and both renderers proceed |
| One-page, one accepted image | The one page satisfies both boundary roles |
| Forged or contradictory evidence | Formal lifecycle gate fails before output mutation |

## 7. Live acceptance node #52

After #58 is merged:

1. derive separate briefs for the first and final pages of a real multi-page deck;
2. compile and inspect both prompts before provider use;
3. call an available ImageGen capability with only approved fields/references;
4. ingest both untouched results and verify deterministic evidence;
5. visually inspect subject count, semantic action, contamination, composition, and edit invariants for each;
6. request an explicit user decision for each exact candidate;
7. register only the accepted results to their correct boundary slots;
8. build HTML and PPTX and verify both formats bind the same two accepted hashes;
9. open the exact PPTX artifact in Microsoft PowerPoint and bind the observation to its hash.

No fake provider, structural ZIP check, HTML preview, or screenshot alone can close #52.

## 8. Queue and closeout rules

- GitHub Issue state and `Parent:` / `Depends on:` body metadata are authoritative.
- Before implementation, compute the queue from a fresh normalized snapshot in strict mode and publish one visible claim.
- One session owns only #58 during implementation. #52 remains Blocked until #58 is merged and closed.
- Replace the implementation claim with the linked PR; then follow PR CI and post-merge default-branch CI to terminal state.
- Recompute the queue after claim, PR, merge, closure, dependency change, or failure.
- Close #50 only after both children satisfy their distinct completion boundaries.
