import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { createRefinementScope, inspectRefinementPptx } from "../src/refinement/pptx-inspection.js";

test("refinement inspection assigns stable object identities and reports unsupported features", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-inspect-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(file, bytes);
  const source = { id: "source-existing", sha256: sha(bytes), original_name: "existing.pptx", bytes: bytes.length };

  const first = await inspectRefinementPptx(file, source);
  const second = await inspectRefinementPptx(file, source);
  assert.deepEqual(second, first);
  assert.equal(first.slide_count, 2);
  assert.deepEqual(first.object_counts, { text_box: 1, picture: 1, chart: 1 });
  assert.deepEqual(first.findings.map(({ slide, feature }) => ({ slide, feature })), [
    { slide: 1, feature: "animation_or_timing" },
    { slide: 2, feature: "chart_editing_pending" }
  ]);
  assert.equal(first.slides[0].objects[0].text_sha256, sha(Buffer.from("Confidential result 42")));
  assert.equal(JSON.stringify(first).includes("Confidential result 42"), false);
  await assert.rejects(inspectRefinementPptx(file, { ...source, sha256: "0".repeat(64) }), { code: "REFINEMENT_SOURCE_CHANGED" });
});

test("refinement scope permits only explicit visual properties on supported objects", async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-scope-")), "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(file, bytes);
  const inspection = await inspectRefinementPptx(file, { id: "source-existing", sha256: sha(bytes), original_name: "existing.pptx", bytes: bytes.length });
  const textBox = inspection.slides[0].objects.find((object) => object.type === "text_box");
  const scope = createRefinementScope(inspection, { actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["font_size", "position"], objective: "Improve hierarchy" }] });
  assert.deepEqual(scope.targets[0].properties, ["font_size", "position"]);
  assert.equal(scope.preservation.text, true);
  assert.equal(scope.acceptance.real_powerpoint, "pending");
  assert.throws(() => createRefinementScope(inspection, { actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["text"] }] }), { code: "REFINEMENT_PROPERTY_FORBIDDEN" });
  const chart = inspection.slides[1].objects.find((object) => object.type === "chart");
  assert.throws(() => createRefinementScope(inspection, { actor: "user:syna", targets: [{ slide: 2, object_id: chart.id, properties: ["fill_color"] }] }), { code: "REFINEMENT_OBJECT_UNSUPPORTED" });
});

test("application service stores the original, inspection, and idempotent scope without editing the PPTX", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-service-"));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "refinement-fixture", title: "Refinement Fixture" });
  const input = path.join(root, "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(input, bytes);
  const service = await ApplicationService.open(projectDir);
  try {
    const inspected = await service.inspectPptxRefinement(input);
    const textBox = inspected.inspection.slides[0].objects.find((object) => object.type === "text_box");
    const request = { sourceId: inspected.source.id, actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["position"] }] };
    const first = await service.proposePptxRefinementScope(request);
    const second = await service.proposePptxRefinementScope(request);
    assert.equal(second.scope.id, first.scope.id);
    assert.equal(sha(await fs.readFile(path.join(projectDir, inspected.source.file))), sha(bytes));
    assert.equal(JSON.parse(await fs.readFile(path.join(projectDir, first.scope_file), "utf8")).acceptance.user_decision, "pending");
  } finally {
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function refinementPptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Confidential result 42</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="3" name="Photo"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld><p:timing/></p:sld>`);
  zip.file("ppt/slides/slide2.xml", `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
