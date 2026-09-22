import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkUpdateReminder, clearUpdateReminderCache, UPDATE_REMINDER_TTL_MS } from "../src/update/reminder.js";

const commit = "a".repeat(40);
const available = { update_available: true, current_version: "1.0.0", target_version: "1.0.0", commit, changes: [{ authorization: "Bearer secret" }] };

test("a second reminder check inside the 24-hour TTL makes no remote check", async (t) => {
  const stateRoot = await temporaryState(t);
  const start = Date.parse("2026-09-11T12:00:00.000Z");
  let calls = 0;
  const check = async () => { calls += 1; return available; };
  const first = await checkUpdateReminder({ stateRoot, check, now: () => start });
  const second = await checkUpdateReminder({ stateRoot, check, now: () => start + UPDATE_REMINDER_TTL_MS - 1 });

  assert.equal(first.status, "update-available");
  assert.equal(first.cache, "refreshed");
  assert.equal(second.status, "update-available");
  assert.equal(second.cache, "fresh");
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(path.join(stateRoot, ".gitignore"), "utf8"), "*\n");
  assert.doesNotMatch(await fs.readFile(path.join(stateRoot, "agent-check.json"), "utf8"), /authorization|Bearer|changes/);
  await clearUpdateReminderCache(stateRoot);
  await assert.rejects(fs.access(path.join(stateRoot, "agent-check.json")), { code: "ENOENT" });
});

test("force bypasses a fresh cache but remains a read-only availability check", async (t) => {
  const stateRoot = await temporaryState(t);
  const start = Date.parse("2026-09-11T12:00:00.000Z");
  let calls = 0;
  const check = async () => ({ ...available, update_available: calls++ > 0 });
  const first = await checkUpdateReminder({ stateRoot, check, now: start });
  const forced = await checkUpdateReminder({ stateRoot, check, force: true, now: start + 1 });

  assert.equal(first.status, "no-update");
  assert.equal("advisory" in first, false);
  assert.equal(forced.status, "update-available");
  assert.equal(calls, 2);
  assert.equal(forced.advisory.choices.preview, "node update.mjs preview");
  assert.match(forced.advisory.choices.apply, /Ask the user for approval/);
});

test("an invalid cache is distinguishable and an explicit force refresh repairs it", async (t) => {
  const stateRoot = await temporaryState(t);
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, "agent-check.json"), "{not-json\n");
  let calls = 0;
  const check = async () => { calls += 1; return { ...available, update_available: false }; };

  const invalid = await checkUpdateReminder({ stateRoot, check });
  assert.equal(invalid.status, "invalid-cache");
  assert.equal(invalid.diagnostic.code, "UPDATE_CACHE_INVALID");
  assert.equal(calls, 0);

  const repaired = await checkUpdateReminder({ stateRoot, check, force: true });
  assert.equal(repaired.status, "no-update");
  assert.equal(calls, 1);
  await assert.doesNotReject(() => fs.readFile(path.join(stateRoot, "agent-check.json"), "utf8").then(JSON.parse));
});

test("network, GitHub selection, and unavailable-tool failures fail open without leaking errors", async (t) => {
  for (const [index, code] of ["UPDATE_NETWORK_FAILED", "UPDATE_NO_TESTED_COMMIT", "ENOENT"].entries()) {
    const stateRoot = path.join(await temporaryState(t), String(index));
    const check = async () => { const error = new Error("Authorization: Bearer very-secret-token"); error.code = code; throw error; };
    const result = await checkUpdateReminder({ stateRoot, check });
    assert.equal(result.ok, true);
    assert.equal(result.status, "offline-or-degraded");
    assert.equal(result.diagnostic.code, code);
    assert.doesNotMatch(JSON.stringify(result), /very-secret-token|Authorization|Bearer/);
  }
});

async function temporaryState(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-reminder-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
