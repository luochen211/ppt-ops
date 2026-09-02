# ADR 0006: Rejection-driven semantic reconstruction

- Status: Accepted
- Date: 2026-09-02

## Context

A presentation Candidate can be structurally valid and still fail in Microsoft PowerPoint or fail the user's intended information relationship. Repeating generation without preserving the inspected artifact, exact feedback, evaluation dimension, diagnosis, and parent attempt turns revision into an untraceable chat loop. It also encourages local styling changes when the page's cognitive task or semantic model is wrong.

## Decision

Candidate revision is a persisted human-in-the-loop state machine:

```text
generated -> validating -> ready_for_review
  -> awaiting_powerpoint_observation
  -> awaiting_user_decision
  -> accepted -> applied_to_draft
  |  continued
  |  rejected
  `- reconstruction_required
```

A `viewed` PowerPoint observation identifies Microsoft PowerPoint, the inspected candidate artifact, and positive page numbers. Automated rendering evidence cannot satisfy this transition. A user decision is one of `accept`, `continue_iteration`, or `reject`; conversational phrases such as “continue” are never acceptance.

Every decision creates an append-only `candidate_feedback` record. `eval_category` identifies the dimension being judged:

- `content_fidelity`
- `cognitive_clarity`
- `semantic_accuracy`
- `visual_hierarchy`
- `aesthetic_brand`
- `powerpoint_fidelity`
- `editability`
- `cross_page_continuity`
- `evidence_provenance`
- `user_acceptance`

`root_cause` separately diagnoses the repair route: content truth, page task, information relationship, visual grammar, PowerPoint implementation, or process. Repeated user rejection with the same root-cause fingerprint forces `reconstruction_required`. Automated QA rejections are recorded with `actor=automated_qa`, remain separate from PowerPoint and user evidence, and do not increment the user-rejection threshold.

A child of `reconstruction_required` must record the discarded hypothesis, page task, semantic roles, information relationship, and new visual mapping hypothesis. Its patch must update `task`, `three_second_message`, and `relation`. Candidates preserve parent IDs, attempt numbers, hypotheses, patches, feedback, and immutable evidence for comparison and recovery.

## Consequences

- The current persisted state defines legal resume events; stale revisions and invalid shortcuts fail deterministically.
- A Candidate cannot be applied before real PowerPoint observation and explicit acceptance.
- The second same-cause user rejection stops local style repair and requires semantic reconstruction.
- Evaluation categories can evolve independently from root-cause routing.
- PPT-Ops retains its local Codex + Skill + project-data product shape; no web workbench or external graph runtime is required.
