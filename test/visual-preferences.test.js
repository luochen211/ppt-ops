import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VisualPreferenceProfileStore,
  visualPreferenceProfileFile
} from "../src/preferences/visual-profile.js";

const digest = crypto.createHash("sha256").update("reference deck").digest("hex");
const observed = [{ property: "body density", value: "short labels with generous whitespace" }];

async function fixture(t) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-visual-preferences-"));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  let tick = 0;
  const store = new VisualPreferenceProfileStore({ repositoryRoot, now: () => `2026-09-10T00:00:0${tick++}.000Z` });
  return { repositoryRoot, store };
}

test("reference decks require explicit user nomination and safe relative metadata", async (t) => {
  const { repositoryRoot, store } = await fixture(t);
  await assert.rejects(store.nominateReference({ id: "deck-one", file: "references/deck.pptx", sha256: digest, actor: "agent" }), /explicit user action/);
  await assert.rejects(store.nominateReference({ id: "deck-one", file: "../private/deck.pptx", sha256: digest, actor: "user" }), /safe relative path/);

  const reference = await store.nominateReference({ id: "deck-one", file: "references/deck.pptx", sha256: digest, title: "Chosen deck", actor: "user" });
  assert.equal(reference.nominated_by, "user");
  assert.equal(reference.file, "references/deck.pptx");
  assert.equal(path.relative(repositoryRoot, visualPreferenceProfileFile(repositoryRoot)), path.join("config", "visual-preferences.json"));
});

test("observations stay separate from inferred preferences until explicit acceptance", async (t) => {
  const { store } = await fixture(t);
  await store.nominateReference({ id: "deck-one", file: "references/deck.pptx", sha256: digest, actor: "user" });
  const proposed = await store.proposeFromReference({
    id: "prefer-space",
    kind: "preferred_pattern",
    dimension: "whitespace",
    statement: "Prefer generous whitespace around one primary message.",
    observed_properties: observed,
    reference_ids: ["deck-one"]
  });
  assert.equal(proposed.status, "proposed");
  assert.deepEqual(await store.accepted(), []);
  await assert.rejects(store.decide("prefer-space", { decision: "accept", actor: "agent", raw_feedback: "Looks right" }), /explicit user action/);

  await store.decide("prefer-space", { decision: "accept", actor: "user", raw_feedback: "Use this preference" });
  assert.deepEqual((await store.accepted()).map(({ id }) => id), ["prefer-space"]);
});

test("repeated aesthetic feedback may propose but never accept a durable preference", async (t) => {
  const { store } = await fixture(t);
  const feedback = [feedbackRecord("feedback-one"), feedbackRecord("feedback-two")];
  await assert.rejects(store.proposeFromRepeatedFeedback({
    id: "avoid-dense-copy", kind: "anti_pattern", dimension: "density", statement: "Avoid paragraph-heavy live slides.", observed_properties: observed,
    feedback: [feedback[0]], root_cause_fingerprint: "dense-live-slide"
  }), /at least two distinct user rejections/);

  const candidate = await store.proposeFromRepeatedFeedback({
    id: "avoid-dense-copy", kind: "anti_pattern", dimension: "density", statement: "Avoid paragraph-heavy live slides.", observed_properties: observed,
    feedback, root_cause_fingerprint: "dense-live-slide"
  });
  assert.equal(candidate.status, "proposed");
  assert.deepEqual(candidate.evidence.source_ids, ["feedback-one", "feedback-two"]);
  assert.deepEqual(await store.accepted(), []);
});

test("users can revise, reject, and remove preferences without erasing history", async (t) => {
  const { store } = await fixture(t);
  await store.nominateReference({ id: "deck-one", file: "references/deck.pptx", sha256: digest, actor: "user" });
  await store.proposeFromReference({ id: "preference-one", kind: "preferred_pattern", dimension: "rhythm", statement: "Alternate dense and breathing pages.", observed_properties: observed, reference_ids: ["deck-one"] });
  await store.decide("preference-one", { decision: "accept", actor: "user", raw_feedback: "Yes" });
  const revised = await store.revise("preference-one", { id: "preference-two", statement: "Avoid more than two dense pages in succession.", actor: "user", raw_feedback: "Make it specific" });
  assert.equal(revised.status, "proposed");
  assert.deepEqual(await store.accepted(), []);

  await store.decide("preference-two", { decision: "accept", actor: "user", raw_feedback: "Use the revision" });
  await store.remove("preference-two", { actor: "user", raw_feedback: "This no longer represents my preference" });
  assert.deepEqual(await store.accepted(), []);
  const profile = await store.load();
  assert.equal(profile.candidates.find(({ id }) => id === "preference-one").status, "superseded");
  assert.equal(profile.candidates.find(({ id }) => id === "preference-two").status, "removed");
  assert.ok(profile.history.some(({ type }) => type === "candidate.removed"));
});

function feedbackRecord(id) {
  return {
    id,
    actor: "user",
    decision: "reject",
    findings: [{ eval_category: "aesthetic_brand", root_cause_fingerprint: "dense-live-slide" }]
  };
}
