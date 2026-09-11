# Independent target-user trial record

Status: pending. Copy this template per participant; empty fields are not passing evidence.

- Participant ID (pseudonym):
- Profile category:
- Started at (UTC):
- Completed at (UTC):
- Repository commit / installed release:
- Source type and slide count (no private source content):
- Code modified during trial: unknown
- Participant completion decision (verbatim, redacted):

| Step | Result (pending / passed / failed) | Artifact ID, hash, evidence or blocker |
| --- | --- | --- |
| Install and enter through `$ppt-agent` | pending | |
| Import source and inspect extraction/references | pending | |
| Confirm Outline and PageSpecs | pending | |
| Explicitly select presentation / outline and output formats | pending | |
| Approve the exact outline revision, if delivering an outline | pending | |
| Freeze and build, if delivering a presentation | pending | |
| Inspect exact artifacts and record separate automated / native / user decisions | pending | |
| PowerPoint: open, copy object, edit text, save/reopen, slideshow | pending | |
| PowerPoint: check selected fonts and visible substitution | pending | |
| Accept exact delivery artifacts and inspect selected-only handoff | pending | |

## Participant prompts

Use the documented installation and conversation entry. Bring your own permitted source or a non-sensitive example. State the audience, purpose and expected length; select the deliverable and formats explicitly. Ask for corrections in conversation. Do not edit repository code. If a step fails, retain the failure and resume only through supported commands.

For the PowerPoint test, work in a copy. Duplicate one text object, change its text, save/reopen the file, and verify the change persists. Start and advance the slideshow. Check a Chinese body-text sample and an English/number sample using the intended fonts. Record the application version and any replacement font. Keep this editing copy distinct from the hashed delivery artifact.

## Failure and recovery log

Record the failing step, exact visible message, relevant project/build/review/handoff IDs, supported recovery used, and whether outside help was necessary. A developer intervention that changes code must be recorded; it cannot count as a no-code trial.

## Evidence review

Remove private content before committing a record. Review evidence truthfulness, participant independence, exact artifact hashes and the no-code result before changing the release matrix. A filled form alone does not pass the gate.
