# User-approved visual preferences

The user-owned profile is `config/visual-preferences.json`; explicitly nominated PPTX files are copied to `config/visual-references/<sha256>.pptx`. Updates protect both locations. No unrelated files are scanned.

The conversation procedure lives in `.agents/skills/ppt-agent/references/visual-preferences.md`. Internal CLI entry points:

```sh
pptops visual-preference <repository-root> --action inspect
pptops visual-preference <repository-root> --action nominate --payload '{"id":"reference-one","file":"/chosen/deck.pptx","actor":"user"}'
pptops visual-preference <repository-root> --action observe --payload '{"id":"reference-one"}'
pptops visual-preference <repository-root> --action propose --payload '{"id":"more-space","kind":"preferred_pattern","dimension":"whitespace","statement":"Leave space around the main message","reference_ids":["reference-one"]}'
pptops visual-preference <repository-root> --action decide --payload '{"candidate_id":"more-space","decision":"accept","actor":"user","raw_feedback":"Use this preference"}'
pptops design-context <project-dir> --repository-root <repository-root>
```

Nomination computes and verifies the source digest. Extraction emits only structural counts and explicit font-size ranges, with limitations for inherited styles and rendered geometry. Whitespace, semantic image roles and motifs require rendered inspection: optional `visual_observations` record the dimension, value, reference ID and rendered evidence locator separately from automated counts. These observations remain separate from the inferred `statement`; neither is silently accepted.

Only an explicit user decision activates a preferred pattern or anti-pattern. Repeated feedback uses actual `candidate_feedback` records from the specified project and needs at least two user aesthetic rejections with the same fingerprint. The project ID accompanies feedback provenance. Proposal creation persists an audit candidate, not an active preference.

Inspect, revise, reject and remove remain available. Revision supersedes the original and creates an unaccepted replacement. Design reads accepted entries afresh through `design-context`; that context contains no reference text, artwork or rendered slides. Missing profiles return an empty list without writing a file. User review must prevent an inferred statement from copying a creator's identity; structural extraction cannot decide that judgment automatically.
