# Visual Asset Pipeline Delivery DAG

> Source of truth: `docs/visual-asset-pipeline-requirements.md`
>
> GitHub Epic: [#50](https://github.com/luochen211/ppt-ops/issues/50)
>
> Planning baseline: 2026-09-02, `origin/main` at `9a6db60`

## 1. Next goal

Deliver one controlled vertical slice that turns an approved page `visual_job` into a generated visual, preserves its evidence, requires explicit visual and user decisions, registers only an accepted file, and renders the same `asset_id` in self-contained HTML and editable PPTX.

The goal is complete at two different evidence levels:

1. **Foundation complete**: provider-neutral code, deterministic fake-provider tests, immutable local records, registration gates, dual rendering, Agent instructions, merged PR, and green CI.
2. **Live acceptance complete**: one real ImageGen result goes through that exact path and the built PPTX is inspected in Microsoft PowerPoint.

These levels may not substitute for one another.

## 2. Dependency graph

```text
#51 Implement the Visual Asset Pipeline vertical slice
  |
  v
#52 Validate a live generated visual in Microsoft PowerPoint
  |
  v
#50 Epic: deliver the Visual Asset Pipeline
```

| Issue | Queue rule | Deliverable | Completion boundary |
|---|---|---|---|
| [#51](https://github.com/luochen211/ppt-ops/issues/51) | Ready when unclaimed | Complete provider-neutral vertical slice | Code, tests, PR, default-branch CI |
| [#52](https://github.com/luochen211/ppt-ops/issues/52) | Depends on #51 | One live generation and exact-artifact PowerPoint observation | Real provider and Microsoft PowerPoint evidence |
| [#50](https://github.com/luochen211/ppt-ops/issues/50) | Parent | Epic audit and closeout | #51 and #52 both Done |

## 3. Why the implementation is one vertical node

The prompt contract, attempt evidence, registration gate, `assets.json`, `asset_slots`, and both renderers form one transaction boundary. Splitting them among concurrent workers would give several nodes ownership of the same schemas, CLI, fixtures, and renderer contracts. Issue #51 therefore owns the coherent vertical slice; live provider and PowerPoint truth stay in #52 because they are separate external acceptance evidence.

## 4. Issue #51 implementation plan

### A. Contract and prompt compiler

- Add explicit entities for visual briefs, generations, observations, and decisions.
- Validate role, generation mode, semantic action, subject count, ratio, text policy, transparency, selected references, edit scope, and invariants.
- Compile the stable 12-section English prompt in the order defined by the requirements.
- Add the restrained faceted low-poly editorial preset derived from the archived working pattern.

### B. Attempt and evidence lifecycle

- Introduce a provider interface whose request contains the prompt, dimensions/ratio, and only explicitly selected references.
- Store every attempt below `.pptops/visual-assets/<generation-id>/` without overwriting earlier attempts.
- Record prompt hash, provider/model summary, selected reference hashes, output hash, and deterministic inspection.
- Verify project-root containment, PNG/JPEG/WebP signature, MIME, size, dimensions, ratio, and PNG alpha-channel facts.
- Keep semantic action, subject count, visible text, logo, style, edit invariants, and copy-safe space pending until a visual observation records them.

### C. Decisions and registration

- Permit user acceptance only after required deterministic checks and a passing visual observation.
- Keep Agent observation and user decision in separate append-only records.
- Register only accepted generations into `assets/`, `assets.json`, and one selected page slot.
- Reject stale page selection, path escape, duplicate asset id, and destination overwrite without partial project mutation.

### D. Dual rendering

- Continue embedding the accepted asset in self-contained HTML.
- Add native PptxGenJS image objects for the same `asset_id`.
- Implement deterministic centered `contain` and `cover`; keep page text and standard shapes native.
- Fail builds for unresolved or unsafe referenced assets.

### E. Agent route and verification

- Teach `$ppt-agent` when to request a character, scene, diagram, or background, how to call an available ImageGen tool, how to ingest its output, and which acceptance claims remain pending.
- Add prompt, lifecycle, path, alpha, registration, HTML, PPTX, and backward-compatibility tests.
- Run focused tests, the full suite, project review, and `git diff --check`.

## 5. Conflict and file ownership

Issue #51 may change:

- `src/visual-assets/**`;
- visual-asset contract/schema files;
- visual-asset CLI routing;
- `src/adapters/pptx.js` and the minimum shared project/path helpers;
- `.agents/skills/ppt-agent/**`;
- focused tests, examples, and visual-asset documentation.

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
| Legacy project without generated assets | Validation and both builds remain valid |

## 7. Live acceptance node #52

After #51 is merged:

1. derive a brief from a real page task;
2. compile and inspect the prompt before provider use;
3. call an available ImageGen capability with only approved fields/references;
4. ingest the untouched result and verify deterministic evidence;
5. visually inspect subject count, semantic action, contamination, composition, and edit invariants;
6. request an explicit user decision;
7. register only the accepted result;
8. build HTML and PPTX from the same asset hash;
9. open the exact PPTX artifact in Microsoft PowerPoint and bind the observation to its hash.

No fake provider, structural ZIP check, HTML preview, or screenshot alone can close #52.

## 8. Queue and closeout rules

- GitHub Issue state and `Parent:` / `Depends on:` body metadata are authoritative.
- Before implementation, compute the queue from a fresh normalized snapshot in strict mode and publish one visible claim.
- One session owns only #51 during implementation. #52 remains Blocked until #51 is merged and closed.
- Replace the implementation claim with the linked PR; then follow PR CI and post-merge default-branch CI to terminal state.
- Recompute the queue after claim, PR, merge, closure, dependency change, or failure.
- Close #50 only after both children satisfy their distinct completion boundaries.
