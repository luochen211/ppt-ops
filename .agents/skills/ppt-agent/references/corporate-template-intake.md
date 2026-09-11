# Corporate template intake

When the user asks to reuse an organization's presentation identity, treat PPTX/POTX, HTML, and PDF as template/reference inputs, not ordinary content Sources. Inspect only named local files. Preserve each original immutably and keep the resulting profile proposed until explicit user acceptance.

Describe the capability boundary plainly: PPTX/POTX may provide native Open XML theme, master, layout, and placeholder evidence; HTML provides contained DOM/CSS and observed layout evidence; PDF provides fixed-page visual/reference evidence. Never claim that HTML or PDF proves an editable PowerPoint master. Never execute macros, scripts, actions, embedded objects, or remote resources.

Do not reuse template copy, examples, customer names, metrics, or claims as project facts. Show conflicts between references and ask which source wins. Imported profiles and corporate assets remain Project/User Layer data.

Use `corporate-template` import/compare/preview to prepare a reviewable report. Present supported choices and conflicts, then use accept with the user's actual decision and exact inspection hashes. Apply the accepted identity only with the current project revision and the user's application decision. Do not invent user acceptance or use a synthetic test decision in a real project.

Accepted profiles materialize at draft read/freeze and are inherited by pinned audience variants. Use page-local overrides for an explicit exception. Carry the identity through Version, Build, Review and Handoff. See `docs/corporate-template-intake.md` for command payloads and the remaining native master/media and PowerPoint acceptance boundaries.
