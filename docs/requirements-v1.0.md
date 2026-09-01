# PPT-Ops V1.0 Requirements

## Delivery goal

V1.0 turns the validated v0.1 dual-renderer foundation into a usable local CLI workflow. A creator can start a project outside this repository, validate it, build HTML and editable PPTX outputs together, and produce an evidence-bearing handoff package without manually assembling the project contract.

## User workflow

```text
pptops init <project-dir>
  -> edit brief, page specifications, theme, and assets
pptops validate <project-dir>
  -> correct contract or reference errors
pptops prototype <project-dir> --pages 1,2
  -> review bounded page intent
pptops deliver <project-dir>
  -> build configured HTML/PPTX outputs, review, and package
```

## V1.0 acceptance criteria

- `init` creates a valid 1.0 project with a safe starter page, theme, brief, and empty asset manifest.
- `init` refuses to overwrite a non-empty directory.
- `validate` provides a dedicated, scriptable contract check.
- `build --format all` produces HTML and PPTX in one invocation.
- `deliver` builds configured supported outputs, writes the review report, and creates a non-overwriting handoff package.
- Existing 0.1 projects remain readable and buildable.
- CLI options fail clearly when malformed or unknown.
- Package and CLI version report `1.0.0`.
- Automated checks, human visual acceptance, and real PowerPoint acceptance remain separate claims.

## Boundaries retained from v0.1

- HTML and PPTX are independent renderers over the same semantic page model.
- V1.0 does not invent business facts or claim visual approval from structural checks.
- V1.0 does not provide online collaboration, automatic publishing, HTML-to-PPTX conversion, or existing-PPTX round-trip editing.
