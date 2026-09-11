import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";
import { hashFile } from "../src/delivery/pdf.js";
import { reindexProject } from "../src/doctor/index.js";
process.env.PPT_OPS_RENDER_QA = "0";
const exec = promisify(execFile);

test("executive and workshop workflows pin sources and adopt one shared correction explicitly", async t => {
  const { root, service } = await fixture(t);
  const base = await service.freezeVersion();
  for (const variant of [definition("executive", base.id, ["page-001", "page-002", "page-004"]), definition("workshop", base.id, ["page-001", "page-002", "page-003", "page-004"])]) await save(service, variant);
  const before = await service.manageAudienceVariants("list");
  const short = await service.freezeVersion({ variantId: "executive" });
  const long = await service.freezeVersion({ variantId: "workshop" });
  assert.equal(short.variant.base_revision, base.snapshot_hash);
  assert.equal(long.variant.base_version_id, base.id);
  assert.notEqual(short.variant.override_revision, long.variant.override_revision);
  const shortProject = await service.projectFromVersion(short.id);
  assert.deepEqual(shortProject.pages.map(page => page.id), ["page-001", "page-002", "page-004"]);
  const { build } = await service.createBuild({ versionId: short.id, targets: ["html", "pptx"] });
  const workshopBuild = (await service.createBuild({ versionId: long.id, targets: ["html"] })).build;
  assert.deepEqual(build.config.variant, short.variant);
  const { review } = await service.runReview(build.id);
  assert.deepEqual(review.variant, short.variant);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "synthetic workflow fixture" } });
  const selection = await service.selectDelivery({ artifactType: "presentation", formats: ["pptx"], sourceId: build.id, sourceRevision: short.id, actor: "user", buildId: build.id });
  const handoff = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: selection.decision.id });
  assert.deepEqual(handoff.handoff.variant, short.variant);
  assert.deepEqual(JSON.parse(await fs.readFile(handoff.manifest_file)).variant, short.variant);
  const retained = [path.join(root, `.pptops/versions/${short.id}/snapshot.json`), path.join(root, `.pptops/builds/${build.id}/pptx/slides.pptx`), path.join(root, `.pptops/builds/${workshopBuild.id}/html/slides.html`), handoff.manifest_file];
  const hashes = await Promise.all(retained.map(hashFile));
  const pages = JSON.parse(await fs.readFile(path.join(root, "pages.json")));
  pages[1].screen_text.body = ["Revenue was 20"];
  await fs.writeFile(path.join(root, "pages.json"), JSON.stringify(pages));
  const corrected = await service.freezeVersion();
  const impact = await service.manageAudienceVariants("impact", { variant_id: "executive", base_version_id: corrected.id });
  assert.deepEqual(impact.variants[0].inherited_page_ids, ["page-002"]);
  assert.equal(impact.variants[0].stale_frozen_output, true);
  const allImpact = await service.manageAudienceVariants("impact", { base_version_id: corrected.id });
  assert.deepEqual(allImpact.variants.map(item => item.variant_id), ["executive", "workshop"]);
  const old = await service.manageAudienceVariants("resolve", { variant_id: "executive" });
  assert.deepEqual(old.pages[1].screen_text.body, ["Revenue was 10"]);
  await service.manageAudienceVariants("rebase", { variant_id: "executive", base_version_id: corrected.id, expected_revision: before.revision, actor: "user", raw_feedback: "Apply the corrected revenue only to the executive brief" });
  const updated = await service.freezeVersion({ variantId: "executive" });
  assert.notEqual(updated.id, short.id);
  assert.equal(updated.variant.base_version_id, corrected.id);
  assert.deepEqual((await service.projectFromVersion(updated.id)).pages[1].screen_text.body, ["Revenue was 20"]);
  assert.equal((await service.freezeVersion({ variantId: "workshop" })).id, long.id);
  const comparison = await service.manageAudienceVariants("compare", { variant_id: "executive", other_variant_id: "workshop" });
  assert.deepEqual(comparison.added_page_ids, ["page-003"]);
  assert.ok(comparison.page_diffs.some(diff => diff.field === "screen_text.body"));
  const state = await service.manageAudienceVariants("list");
  await service.manageAudienceVariants("archive", { variant_id: "workshop", expected_revision: state.revision, actor: "user", raw_feedback: "Archive the workshop" });
  await assert.rejects(service.freezeVersion({ variantId: "workshop" }), { code: "AUDIENCE_VARIANT_ARCHIVED" });
  assert.deepEqual(await Promise.all(retained.map(hashFile)), hashes);
  assert.equal((await service.manageAudienceVariants("resolve", { variant_id: "executive" })).pages[1].screen_text.title, "Decision required");
  service.close();
  await reindexProject(root);
  const reopened = await ApplicationService.open(root);
  try { assert.deepEqual(reopened.requireBuild(build.id).config.variant, short.variant); assert.deepEqual(reopened.requireEntity("review", review.id).variant, short.variant); }
  finally { reopened.close(); }
});

test("variant decisions require current revisions and exact frozen base integrity", async t => {
  const { root, service } = await fixture(t);
  const base = await service.freezeVersion();
  const variant = definition("executive", base.id, ["page-001", "page-002", "page-004"]);
  const state = await service.manageAudienceVariants("list");
  await assert.rejects(service.manageAudienceVariants("save", { variant, expected_revision: state.revision, actor: "agent", raw_feedback: "assumed" }), { code: "AUDIENCE_VARIANT_USER_REQUIRED" });
  await save(service, variant);
  await assert.rejects(service.manageAudienceVariants("save", { variant, expected_revision: state.revision, actor: "user", raw_feedback: "old" }), { code: "AUDIENCE_VARIANT_STALE" });
  const file = path.join(root, "variants.json");
  const data = JSON.parse(await fs.readFile(file));
  data.variants[0].purpose = "unaccepted edit";
  await fs.writeFile(file, JSON.stringify(data));
  await assert.rejects(service.freezeVersion({ variantId: "executive" }), { code: "AUDIENCE_VARIANT_NOT_ACCEPTED" });
  const snapshotFile = path.join(root, `.pptops/versions/${base.id}/snapshot.json`);
  const snapshot = JSON.parse(await fs.readFile(snapshotFile)); snapshot["pages.json"][1].screen_text.title = "tampered";
  await fs.writeFile(snapshotFile, JSON.stringify(snapshot));
  await assert.rejects(save(service, variant), { code: "AUDIENCE_VARIANT_BASE_CHANGED" });
});

test("CLI exposes variant management while an implicit default remains unchanged", async t => {
  const { root, service } = await fixture(t);
  const base = await service.freezeVersion();
  const run = async (...args) => JSON.parse((await exec(process.execPath, [path.resolve("src/cli.js"), ...args])).stdout).data;
  const state = await run("variant-manage", root, "--action", "list");
  assert.equal(state.implicit_default, true);
  assert.equal((await service.freezeVersion()).id, base.id);
  await run("variant-manage", root, "--action", "save", "--payload", JSON.stringify({ variant: definition("executive", base.id, ["page-001", "page-002", "page-004"]), expected_revision: state.revision, actor: "user", raw_feedback: "Create the executive brief" }));
  const frozen = await run("version-freeze", root, "--variant", "executive");
  assert.equal(frozen.variant.variant_id, "executive");
});

async function save(service, variant) {
  const state = await service.manageAudienceVariants("list");
  return service.manageAudienceVariants("save", { variant, expected_revision: state.revision, actor: "user", raw_feedback: "Accept this exact audience version" });
}
function definition(id, version, pageIds) { return { id, title: id === "executive" ? "Executive brief" : "Workshop", audience: id, purpose: "Make the decision", expected_duration_seconds: id === "executive" ? 300 : 2700, delivery_mode: id === "executive" ? "pitch" : "workshop", base: { project_id: "variant-workflow", revision: version }, page_ids: pageIds, page_overrides: id === "executive" ? [{ page_id: "page-002", patch: { screen_text: { title: "Decision required" } } }] : [], section_overrides: [] }; }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-variant-lifecycle-"));
  await initializeProject(root, { name: "variant-workflow", title: "Shared project" });
  const first = JSON.parse(await fs.readFile(path.join(root, "pages.json")))[0];
  const pages = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(first), id: `page-00${index + 1}`, page: index + 1, screen_text: { title: `Page ${index + 1}`, ...(index === 1 ? { body: ["Revenue was 10"] } : {}) } }));
  const outline = JSON.parse(await fs.readFile(path.join(root, "outline.json"))); outline.sections[0].page_ids = pages.map(page => page.id);
  await fs.writeFile(path.join(root, "pages.json"), JSON.stringify(pages));
  await fs.writeFile(path.join(root, "outline.json"), JSON.stringify(outline));
  await seedAcceptedBoundaryImages(root);
  const service = await ApplicationService.open(root);
  t.after(() => { try { service.close(); } catch {} });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, service };
}
