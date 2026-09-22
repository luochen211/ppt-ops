import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { compareSourceRevision } from "../src/sources/revision-impact.js";

test("source revision impact keeps unrelated locators out and reports unknown bindings", () => {
  const oldSource = { id: "source-001", sha256: "a" };
  const newSource = { id: "source-002", sha256: "b" };
  const oldExtraction = { segments: [{ locator: "p1", text: "10" }, { locator: "p2", text: "same" }] };
  const newExtraction = { segments: [{ locator: "p1", text: "12" }, { locator: "p2", text: "same" }] };
  const pages = [
    { id: "page-001", page: 1, source_refs: [{ source_id: "source-001", locator: "p1" }] },
    { id: "page-002", page: 2, source_refs: [{ source_id: "source-001", locator: "p2" }] },
    { id: "page-003", page: 3, source_refs: [{ source_id: "source-001", locator: "missing" }] }
  ];
  const report = compareSourceRevision(oldSource, newSource, oldExtraction, newExtraction, pages);
  assert.deepEqual(report.page_impacts.map((item) => item.status), ["needs_revision", "unchanged_at_locator", "manual_review"]);
  assert.deepEqual(report.changed_locators, ["p1"]);
});

test("source update previews an immutable snapshot and only proposes on a reviewable page", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-source-update-"));
  const project = path.join(root, "project");
  await initializeProject(project, { name: "source-update-test" });
  const original = (await fs.readFile(path.join(project, "brief.md"), "utf8"));
  const changed = path.join(root, "changed.md");
  await fs.writeFile(changed, original.replace("Describe the audience", "Describe the revised audience"));
  const service = await ApplicationService.open(project);
  t.after(async () => { service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const report = await service.previewSourceUpdate("source-001", changed);
  assert.equal(report.page_impacts[0].status, "manual_review");
  assert.notEqual(report.old_source.sha256, report.new_source.sha256);
  assert.equal((await service.previewSourceUpdate("source-001", changed)).new_source.id, report.new_source.id);
  await assert.rejects(service.proposeSourceUpdateCandidate({ sourceId: "source-001", newSourceId: report.new_source.id, pageId: "page-999", patch: { task: "Revised" }, baseRevision: 1 }), { code: "PAGE_NOT_IMPACTED" });
  const proposed = await service.proposeSourceUpdateCandidate({ sourceId: "source-001", newSourceId: report.new_source.id, pageId: "page-001", patch: { task: "Revised" }, baseRevision: 1 });
  assert.equal(proposed.candidate.state, "ready_for_review");
  assert.equal(service.diffCandidate(proposed.candidate.id).stale, false);
  assert.equal((await fs.readFile(path.join(project, "brief.md"), "utf8")), original);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "pages.json")))[0].task, "Establish the presentation promise");
});
