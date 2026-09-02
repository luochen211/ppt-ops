import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");
process.env.PPT_OPS_RENDER_QA = "0";

test("candidate commands enforce base and object revisions before applying a local patch", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());

  const candidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { screen_text: { title: "Accepted title" } } });
  assert.equal(candidate.state, "ready_for_review");
  assert.equal(service.diffCandidate(candidate.id).stale, false);
  await assert.rejects(service.acceptCandidate(candidate.id, candidate.revision - 1), { code: "STALE_OBJECT_REVISION" });
  await assert.rejects(service.acceptCandidate(candidate.id, candidate.revision), { code: "ILLEGAL_RESUME_EVENT" });
  const rendered = await service.renderCandidate(candidate.id, candidate.revision);
  await fs.access(path.join(project, rendered.render_evidence.artifact));
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "pages.json"), "utf8"))[0].screen_text.title, "Application Commands");
  await assert.rejects(service.renderCandidate(candidate.id, rendered.candidate.revision), { code: "ILLEGAL_RESUME_EVENT" });
  assert.throws(() => service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: { ...powerpointEvidence(rendered), sha256: "0".repeat(64) } }), { code: "POWERPOINT_EVIDENCE_MISMATCH" });
  const observed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(rendered) });
  const accepted = await service.acceptCandidate(candidate.id, observed.candidate.revision);
  assert.equal(accepted.candidate.state, "applied_to_draft");
  assert.equal(accepted.target.screen_text.title, "Accepted title");
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "pages.json"), "utf8"))[0].screen_text.title, "Accepted title");
});

test("a changed target makes an outstanding candidate stale", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  const first = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "First" } });
  const second = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "Second" } });
  const firstRendered = await service.renderCandidate(first.id, first.revision); const secondRendered = await service.renderCandidate(second.id, second.revision);
  const observed = service.recordPowerPointObservation(first.id, { expectedRevision: firstRendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(firstRendered) });
  await service.acceptCandidate(first.id, observed.candidate.revision);
  assert.equal(service.diffCandidate(second.id).stale, true);
  assert.throws(() => service.recordPowerPointObservation(second.id, { expectedRevision: secondRendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(secondRendered) }), { code: "STALE_BASE_REVISION" });
});

test("repeated rejection forces semantic reconstruction and preserves attempt lineage", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());

  const reject = async (candidate, feedback) => {
    const rendered = await service.renderCandidate(candidate.id, candidate.revision);
    const observed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(rendered) });
    return service.decideCandidate(candidate.id, { decision: "reject", expectedRevision: observed.candidate.revision, rawFeedback: feedback, evalCategory: "semantic_accuracy", rootCause: "information_relationship", rootCauseFingerprint: "roles-flattened" });
  };
  const first = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { relation: "process" }, hypothesis: "All roles form one process" });
  const firstDecision = await reject(first, "Inputs and conditions are not peer steps");
  assert.equal(firstDecision.candidate.state, "rejected");
  assert.equal(firstDecision.force_reconstruction, false);

  const second = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { relation: "sequence" }, parentCandidateId: first.id, hypothesis: "Use a sequence instead" });
  const secondDecision = await reject(second, "It still flattens inputs and conditions");
  assert.equal(secondDecision.candidate.state, "reconstruction_required");
  assert.equal(secondDecision.force_reconstruction, true);
  await assert.rejects(service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { relation: "comparison" }, parentCandidateId: second.id }), { code: "RECONSTRUCTION_REQUIRED" });

  const third = await service.proposeCandidate({
    targetKind: "page_spec", targetId: "page-001", baseRevision: 1, parentCandidateId: second.id,
    patch: { task: "Separate roles", three_second_message: "Inputs enable an action that produces an output", relation: "cause_effect" },
    hypothesis: "Separate inputs, action, and output",
    reconstruction: { page_task: "Explain role boundaries", semantic_roles: { input: ["source"], action: ["transform"], output: ["result"], condition: ["approval"] }, information_relationship: "input enables action; action produces output", visual_mapping_hypothesis: "inputs feed a central action and output", discarded_hypothesis: "all roles are peer steps" }
  });
  assert.equal(third.attempt, 3);
  assert.equal(third.parent_candidate_id, second.id);
  assert.equal(service.candidateAttempts({ targetKind: "page_spec", targetId: "page-001" }).length, 3);
  assert.equal(service.candidateFeedback(second.id)[0].raw_feedback, "It still flattens inputs and conditions");
  assert.equal(service.compareCandidates(first.id, third.id).patch_changed, true);
});

test("continue is not acceptance and stale or illegal resume events are rejected", async (t) => {
  const project = await fixture(t); const service = await ApplicationService.open(project); t.after(() => service.close());
  const candidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "Try" } });
  const rendered = await service.renderCandidate(candidate.id, candidate.revision);
  const notViewed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "not_viewed", evidence: { reason: "PowerPoint unavailable" } });
  assert.equal(notViewed.candidate.state, "awaiting_powerpoint_observation");
  await assert.rejects(service.decideCandidate(candidate.id, { decision: "continue_iteration", expectedRevision: rendered.candidate.revision, rawFeedback: "Continue", evalCategory: "visual_hierarchy", rootCause: "process" }), { code: "ILLEGAL_RESUME_EVENT" });
  const observed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(rendered) });
  await assert.rejects(service.decideCandidate(candidate.id, { decision: "reject", expectedRevision: rendered.candidate.revision, rawFeedback: "No", evalCategory: "visual_hierarchy", rootCause: "visual_grammar" }), { code: "STALE_OBJECT_REVISION" });
  const continued = await service.decideCandidate(candidate.id, { decision: "continue_iteration", expectedRevision: observed.candidate.revision, rawFeedback: "Keep exploring", evalCategory: "visual_hierarchy", rootCause: "visual_grammar" });
  assert.equal(continued.candidate.state, "continued");
  await assert.rejects(service.acceptCandidate(candidate.id, continued.candidate.revision), { code: "ILLEGAL_RESUME_EVENT" });
});

test("automated QA rejection remains distinct from PowerPoint and user feedback", async (t) => {
  const project = await fixture(t); const service = await ApplicationService.open(project); t.after(() => service.close());
  const automatic = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "Overflowing candidate" } });
  const automaticRendered = await service.renderCandidate(automatic.id, automatic.revision);
  assert.throws(() => service.recordPowerPointObservation(automatic.id, { expectedRevision: automaticRendered.candidate.revision, status: "viewed", evidence: { application: "PowerPoint" } }), { code: "POWERPOINT_EVIDENCE_INVALID" });
  const qa = service.rejectCandidateByAutomatedQa(automatic.id, { expectedRevision: automaticRendered.candidate.revision, rawFeedback: "Text overflows its box", evalCategory: "powerpoint_fidelity", rootCause: "powerpoint_implementation", rootCauseFingerprint: "overflow", evidence: { check: "text-overflow", page: 1 } });
  assert.equal(qa.feedback.actor, "automated_qa");
  assert.equal(qa.force_reconstruction, false);

  const userCandidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "User candidate" }, parentCandidateId: automatic.id });
  const userRendered = await service.renderCandidate(userCandidate.id, userCandidate.revision);
  const observed = service.recordPowerPointObservation(userCandidate.id, { expectedRevision: userRendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(userRendered) });
  const rejected = await service.decideCandidate(userCandidate.id, { decision: "reject", expectedRevision: observed.candidate.revision, rawFeedback: "The overflow remains", evalCategory: "powerpoint_fidelity", rootCause: "powerpoint_implementation", rootCauseFingerprint: "overflow" });
  assert.equal(rejected.force_reconstruction, false);
  assert.equal(rejected.feedback.actor, "user");
});

test("five rejection and reconstruction rounds preserve resumable state", async (t) => {
  const project = await fixture(t); const service = await ApplicationService.open(project); t.after(() => service.close());
  let parent; let forceCount = 0;
  for (let round = 1; round <= 5; round++) {
    const candidate = await service.proposeCandidate({
      targetKind: "page_spec", targetId: "page-001", baseRevision: 1, parentCandidateId: parent?.id,
      patch: round === 1 ? { relation: "process" } : { task: `Rebuilt task ${round}`, three_second_message: `Rebuilt message ${round}`, relation: "cause_effect" },
      hypothesis: `Attempt ${round}`,
      ...(parent?.state === "reconstruction_required" ? { reconstruction: { page_task: `Task ${round}`, semantic_roles: { input: ["source"], action: ["act"], output: ["result"] }, information_relationship: "input enables action and action produces output", visual_mapping_hypothesis: `Mapping ${round}`, discarded_hypothesis: parent.hypothesis } } : {})
    });
    const rendered = await service.renderCandidate(candidate.id, candidate.revision);
    const observed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: powerpointEvidence(rendered) });
    const result = await service.decideCandidate(candidate.id, { decision: "reject", expectedRevision: observed.candidate.revision, rawFeedback: `Relationship still wrong ${round}`, evalCategory: "semantic_accuracy", rootCause: "information_relationship", rootCauseFingerprint: "same-semantic-failure" });
    if (result.force_reconstruction) forceCount++;
    parent = result.candidate;
  }
  assert.equal(forceCount, 4);
  assert.equal(parent.state, "reconstruction_required");
  assert.equal(service.candidateAttempts({ targetKind: "page_spec", targetId: "page-001" }).length, 5);
  assert.equal(service.candidateFeedback(parent.id).length, 1);
});

test("CLI exposes the PowerPoint feedback loop with stable envelopes", async (t) => {
  const project = await fixture(t);
  const proposed = JSON.parse((await runCli("candidate-propose", project, "--target-kind", "page_spec", "--target-id", "page-001", "--patch", JSON.stringify({ task: "CLI candidate" }), "--base-revision", "1")).stdout).data;
  const rendered = JSON.parse((await runCli("candidate-render", project, "--candidate", proposed.id, "--expected-revision", String(proposed.revision))).stdout).data;
  const observed = JSON.parse((await runCli("candidate-record-powerpoint-observation", project, "--candidate", proposed.id, "--expected-revision", String(rendered.candidate.revision), "--status", "viewed", "--evidence", JSON.stringify(powerpointEvidence(rendered)))).stdout).data;
  const rejected = JSON.parse((await runCli("candidate-reject", project, "--candidate", proposed.id, "--expected-revision", String(observed.candidate.revision), "--raw-feedback", "The hierarchy is flat", "--eval-category", "visual_hierarchy", "--root-cause", "visual_grammar")).stdout).data;
  assert.equal(rejected.candidate.state, "rejected");
  assert.equal(rejected.feedback.eval_category, "visual_hierarchy");
  const feedback = JSON.parse((await runCli("candidate-feedback-show", project, "--candidate", proposed.id)).stdout).data;
  assert.equal(feedback.length, 1);
});

test("formal build, review, and handoff commands require a frozen version and accepted review", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());

  await assert.rejects(service.createBuild({ versionId: "missing", targets: ["pptx"] }), { code: "OBJECT_NOT_FOUND" });
  const version = await service.freezeVersion();
  assert.equal(version.state, "frozen");
  assert.equal((await service.freezeVersion()).reused, true);
  const { build, artifacts } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  assert.equal(build.state, "succeeded");
  assert.equal(artifacts[0].file, `.pptops/builds/${build.id}/pptx/slides.pptx`);
  const { review, report } = await service.runReview(build.id);
  const qa = report.automated_checks.find(({ id }) => id === "pptx-visual-qa");
  assert.ok(["passed", "pending"].includes(qa.status));
  assert.ok(qa.evidence.pages.every(({ page }) => Number.isInteger(page) && page > 0));
  assert.ok(report.acceptance.every(({ status }) => status === "pending"));
  await assert.rejects(service.createHandoff(build.id, review.id), { code: "REVIEW_NOT_ACCEPTED" });
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { reviewer: "test" } });
  const handoff = await service.createHandoff(build.id, accepted.id);
  assert.equal(handoff.handoff.state, "verified");
  const manifest = JSON.parse(await fs.readFile(handoff.manifest_file, "utf8"));
  assert.deepEqual(manifest.outputs.map(({ name }) => name), ["review-report.json", "slides.pptx"]);
});

test("CLI application commands return stable success and error envelopes", async (t) => {
  const project = await fixture(t);
  const frozen = JSON.parse((await runCli("version-freeze", project)).stdout);
  assert.equal(frozen.ok, true);
  assert.equal(frozen.data.state, "frozen");

  await assert.rejects(
    runCli("candidate-accept", project, "--candidate", "missing", "--expected-revision", "1"),
    (error) => {
      const response = JSON.parse(error.stderr.trim().split("\n").at(-1));
      assert.deepEqual({ ok: response.ok, code: response.error.code }, { ok: false, code: "OBJECT_NOT_FOUND" });
      return true;
    }
  );
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-application-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, "project");
  await initializeProject(project, { title: "Application Commands" });
  return project;
}
function runCli(...args) { return execFileAsync(process.execPath, [cli, ...args], { encoding: "utf8" }); }
function powerpointEvidence(rendered) { return { application: "Microsoft PowerPoint", artifact: rendered.render_evidence.artifact, sha256: rendered.render_evidence.sha256, pages: rendered.render_evidence.pages }; }
