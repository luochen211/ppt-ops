# Update reminders

Once per local Codex session, before routing the first PPT Agent request, run `node update.mjs agent-check` as a separate command and parse its JSON result. This command only checks availability and maintains `.pptops-updates/agent-check.json`; it never applies an update.

- `no-update`: continue without mentioning updates.
- `update-available`: give one concise advisory naming `tested_commit` and the three explicit choices from `advisory.choices`: inspect with `preview`, apply only after the user approves it, or dismiss for this session. Continue the presentation request unless the user chooses an update action.
- `offline-or-degraded`: continue presentation work. Keep the sanitized diagnostic as evidence; mention it only when the user asks about updates or diagnostics.
- `invalid-cache`: continue presentation work. The user can request an explicit refresh, which runs `node update.mjs agent-check --force`.

Treat a thrown command error or an unavailable Node, Git, npm, tar, or network tool exactly like `offline-or-degraded`: fail open and continue routing. Never concatenate the advisory or diagnostics onto stdout from `pptops` or another command with a JSON contract. Surface the structured result conversationally instead.

`agent-check` caches successful `no-update` and `update-available` evidence for 24 hours. `--force` bypasses that cache but remains read-only. Neither result authorizes `apply`: `node update.mjs apply` is a separate action and requires an explicit user instruction. Do not create a daemon, scheduler, or background installer.
