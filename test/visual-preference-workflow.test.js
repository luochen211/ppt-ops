import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { observeReference, VisualPreferenceWorkflow } from "../src/preferences/workflow.js";
import { ApplicationService } from "../src/application/service.js";
import { createV1Entity } from "../src/contracts/v1.js";
import { initializeProject } from "../src/core/init.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "preference-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "chosen.pptx");
  const deck = new PptxGenJS();
  deck.addSlide().addText("Protected original wording", { x: 1, y: 1, w: 5, h: 1, fontSize: 32 });
  deck.addSlide().addText("Another source phrase", { x: 1, y: 1, w: 5, h: 1, fontSize: 18 });
  await deck.writeFile({ fileName: file });
  return { root, file, flow: new VisualPreferenceWorkflow(root) };
}
const candidate = { id: "prefer-space", kind: "preferred_pattern", dimension: "whitespace", statement: "Leave space around the main message", reference_ids: ["chosen"] };

test("explicit nomination extracts bounded observations and detects changed provenance", async (t) => {
  const { root, file, flow } = await fixture(t);
  await fs.writeFile(path.join(root, "unrelated.pptx"), "invalid private file");
  await assert.rejects(flow.nominate({ id: "chosen", file, actor: "agent" }), /explicit user/);
  await assert.rejects(flow.observe("chosen"), /unknown user-nominated/);
  const result = await flow.nominate({ id: "chosen", file, actor: "user" });
  assert.deepEqual(result.observations.map((item) => item.property), ["density", "whitespace", "hierarchy", "imagery", "rhythm", "motif"]);
  assert.doesNotMatch(JSON.stringify(result.observations), /Protected original wording|Another source phrase/);
  assert.equal((await flow.store.load()).references.length, 1);
  const proposal = await flow.propose({ ...candidate, visual_observations: [{ property: "whitespace", value: "Clear margin around heading", reference_id: "chosen", evidence: "rendered/page-1.png" }] });
  assert.equal(proposal.observed_properties.at(-1).method, "rendered_visual_inspection");
  assert.deepEqual(await flow.store.accepted(), []);
  await fs.appendFile(path.join(root, result.reference.file), "changed");
  await assert.rejects(flow.observe("chosen"), /hash mismatch/);
});

test("CLI consent controls cross-project Design context and removal takes effect immediately", async (t) => {
  const { root, file } = await fixture(t);
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args])).stdout).data;
  const action = (name, payload) => run("visual-preference", root, "--action", name, "--payload", JSON.stringify(payload));
  const projects = [path.join(root, "one"), path.join(root, "two")];
  for (const [i, dir] of projects.entries()) await initializeProject(dir, { name: `project-${i}`, title: "Test" });
  const context = (dir) => run("design-context", dir, "--repository-root", root);
  assert.deepEqual((await context(projects[0])).visual_preferences, []);
  await assert.rejects(fs.access(path.join(root, "config/visual-preferences.json")), { code: "ENOENT" });
  await action("nominate", { id: "chosen", file, actor: "user" });
  await action("propose", candidate);
  assert.deepEqual((await context(projects[1])).visual_preferences, []);
  await assert.rejects(action("decide", { candidate_id: candidate.id, decision: "accept", actor: "agent", raw_feedback: "yes" }), /explicit user action/);
  await action("decide", { candidate_id: candidate.id, decision: "accept", actor: "user", raw_feedback: "Use that" });
  for (const dir of projects) {
    const result = await context(dir);
    assert.equal(result.visual_preferences[0].statement, candidate.statement);
    assert.doesNotMatch(JSON.stringify(result), /Protected original wording|\.pptx|observed_properties/);
  }
  await action("revise", { candidate_id: candidate.id, id: "revised-space", statement: "More margin", actor: "user", raw_feedback: "Change it" });
  assert.deepEqual((await context(projects[0])).visual_preferences, []);
  await action("decide", { candidate_id: "revised-space", decision: "reject", actor: "user", raw_feedback: "No" });
  await action("propose", { ...candidate, id: "temporary" });
  await action("decide", { candidate_id: "temporary", decision: "accept", actor: "user", raw_feedback: "Yes" });
  await action("remove", { candidate_id: "temporary", actor: "user", raw_feedback: "Remove" });
  assert.deepEqual((await context(projects[1])).visual_preferences, []);
  const profile = await run("visual-preference", root, "--action", "inspect");
  assert.deepEqual(profile.candidates.map((item) => item.status), ["superseded", "rejected", "removed"]);
});

test("feedback workflow does not accept caller-supplied fabricated feedback", async (t) => {
  const { root, flow } = await fixture(t);
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "feedback-project", title: "Test" });
  await assert.rejects(flow.proposeFeedback(projectDir, { ...candidate, root_cause_fingerprint: "dense", feedback: [1, 2] }), /at least two distinct/);
  assert.deepEqual(await flow.store.accepted(), []);
});


test("persisted repeated feedback retains project provenance and only proposes", async (t) => {
  const { root, flow } = await fixture(t);
  const projectDir = path.join(root, "feedback-source");
  await initializeProject(projectDir, { name: "source-project", title: "Test" });
  const service = await ApplicationService.open(projectDir);
  try {
    for (const id of ["feedback-one", "feedback-two"]) {
      service.store.saveEntity(service.projectId, createV1Entity("candidate_feedback", id, {
        candidate_id: "candidate-one", target_id: "page-one", actor: "user", decision: "reject", raw_feedback: "Too dense",
        findings: [{ eval_category: "aesthetic_brand", root_cause: "visual_grammar", root_cause_fingerprint: "dense",
          severity: "major", target: { kind: "page_spec", id: "page-one" }, evidence: {} }]
      }));
    }
  } finally { service.close(); }
  const result = await flow.proposeFeedback(projectDir, { ...candidate, root_cause_fingerprint: "dense" });
  assert.equal(result.status, "proposed");
  assert.equal(result.evidence.project_id, "source-project");
  assert.deepEqual(result.evidence.source_ids, ["feedback-one", "feedback-two"]);
  assert.deepEqual(await flow.store.accepted(), []);
});


test("reference rhythm follows presentation order after slides are reordered", async (t) => {
  const { file } = await fixture(t);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const xml = await zip.file("ppt/presentation.xml").async("string");
  const ids = [...xml.matchAll(/<p:sldId\b[^>]*\/>/g)].map((match) => match[0]);
  assert.equal(ids.length, 2);
  zip.file("ppt/presentation.xml", xml.replace(ids.join(""), ids.toReversed().join("")));
  const observations = await observeReference(await zip.generateAsync({ type: "nodebuffer" }));
  assert.match(observations.find((item) => item.property === "hierarchy").value, /\[\[18\],\[32\]\]/);
});
