import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deliveryCapabilities, exportOutlineMarkdown, readDeliverySelection, recordDeliverySelection } from "../src/delivery/selection.js";
import { createHandoff } from "../src/handoff/index.js";

test("records explicit one-format and multi-format decisions as immutable evidence", async (t) => {
  const root = await temporary(t);
  const now = () => "2026-09-10T12:00:00.000Z";
  const first = await recordDeliverySelection(root, {
    id: "selection-001", artifact_type: "presentation", formats: ["pptx"], available_formats: ["html", "pptx"],
    source_id: "build-007", source_revision: "version-003", actor: "user:syna"
  }, { now });
  const second = await recordDeliverySelection(root, {
    id: "selection-002", artifact_type: "presentation", formats: ["html", "pptx"], available_formats: ["html", "pptx"],
    source_id: "build-007", source_revision: "version-003", actor: "user:syna"
  }, { now });
  assert.deepEqual(first.decision.formats, ["pptx"]);
  assert.deepEqual(second.decision.formats, ["html", "pptx"]);
  assert.equal(second.decision.decided_at, now());
  assert.equal(second.decision.selection_source, "user_conversation");
  assert.notEqual(first.manifest_file, second.manifest_file);
  assert.deepEqual(await readDeliverySelection(root, "selection-002"), second.decision);
  await assert.rejects(readDeliverySelection(root, "../selection-002"), { code: "DELIVERY_SELECTION_INVALID" });
  await assert.rejects(recordDeliverySelection(root, { ...first.decision, available_formats: ["pptx"] }, { now }), { code: "EEXIST" });
});

test("does not choose a default and reports unavailable exporters without changing evidence", async (t) => {
  const root = await temporary(t);
  const base = { artifact_type: "outline", source_id: "outline-main", source_revision: "sha256:abc", actor: "user:syna", available_formats: ["markdown"] };
  await assert.rejects(recordDeliverySelection(root, { ...base, formats: [] }), { code: "DELIVERY_FORMAT_REQUIRED" });
  await assert.rejects(recordDeliverySelection(root, { ...base, formats: ["docx"] }), (error) => {
    assert.equal(error.code, "EXPORTER_UNAVAILABLE");
    assert.equal(error.details.unavailable[0].format, "docx");
    return true;
  });
  assert.deepEqual(deliveryCapabilities({ artifactType: "outline", availableFormats: ["markdown"] }).map(({ format, status }) => [format, status]), [
    ["markdown", "available"], ["docx", "unavailable"], ["pdf", "unavailable"]
  ]);
  await assert.rejects(fs.access(path.join(root, ".pptops", "delivery-selections")));
});

test("exports an approved outline independently from presentation builds", async (t) => {
  const root = await temporary(t);
  const project = {
    root, project: { title: "Delivery Demo" },
    contracts: {
      outline: { sections: [{ title: "Opening", page_ids: ["page-001"] }] },
      pages: [{ id: "page-001", task: "Frame the decision", screen_text: { title: "Choose the delivery" } }]
    }
  };
  const recorded = await recordDeliverySelection(root, {
    id: "outline-selection", artifact_type: "outline", formats: ["markdown"], available_formats: ["markdown"],
    source_id: "outline-main", source_revision: "sha256:def", actor: "user:syna"
  });
  const artifacts = await exportOutlineMarkdown(project, recorded.decision);
  assert.equal(artifacts[0].name, "outline.md");
  assert.match(await fs.readFile(artifacts[0].path, "utf8"), /Choose the delivery — Frame the decision/);
});

test("handoff packages only explicitly selected formats and records the decision", async (t) => {
  const root = await temporary(t);
  const sources = path.join(root, "source");
  await fs.mkdir(sources);
  await fs.writeFile(path.join(sources, "slides.html"), "html");
  await fs.writeFile(path.join(sources, "slides.pptx"), "pptx");
  const selection = { id: "selection-003", artifact_type: "presentation", formats: ["pptx"], source_id: "build-001", source_revision: "version-001", actor: "user:syna", decided_at: "2026-09-10T12:00:00Z" };
  const result = await createHandoff({ root, project: { name: "demo" } }, { summary: {}, passed: true, required_failure_count: 0 }, {
    sourceFiles: [{ name: "slides.pptx", path: path.join(sources, "slides.pptx") }], deliverySelection: selection
  });
  assert.deepEqual(result.manifest.outputs.map(({ name }) => name), ["slides.pptx"]);
  assert.deepEqual(result.manifest.delivery_selection, selection);
  assert.equal(await fs.readFile(path.join(sources, "slides.html"), "utf8"), "html");
});

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-selection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
