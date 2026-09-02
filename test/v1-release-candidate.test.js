import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { runLargeDeckAcceptance } from "../src/acceptance/large-deck.js";
import { validatePptx } from "../src/adapters/pptx.js";

test("release candidate migrates, freezes, builds, and reviews a 50+ slide source deck", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-v1-rc-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, "source-52.pptx");
  const project = path.join(root, "accepted-project");
  await fs.writeFile(input, await sourceDeck(52));

  const result = await runLargeDeckAcceptance({ inputFile: input, projectDir: project, render: false });

  assert.equal(result.input.slide_count, 52);
  assert.equal(result.build.state, "succeeded");
  assert.equal(result.review.passed, true);
  assert.equal(result.review.acceptance.find(({ kind }) => kind === "visual").status, "pending");
  assert.equal(result.review.acceptance.find(({ kind }) => kind === "real_powerpoint").status, "pending");
  assert.ok(result.performance_ms.total < 30_000, `50+ slide acceptance exceeded 30s: ${result.performance_ms.total}ms`);
  const pptx = result.build.artifacts.find(({ file }) => file.endsWith(".pptx"));
  assert.ok(pptx);
  await validatePptx(path.join(project, pptx.file), 52);
  const [projectContract, sources, pages] = await Promise.all(["project.json", "sources.json", "pages.json"].map((file) => fs.readFile(path.join(project, file), "utf8").then(JSON.parse)));
  assert.deepEqual(projectContract.source_ids, [sources[0].id]);
  assert.equal(sources.length, 1);
  assert.equal(pages.length, 52);
  assert.ok(pages.every(({ source_refs }) => source_refs[0].source_id === sources[0].id));
});

test("release candidate rejects a deck below the 50-slide threshold without leaking the store", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-v1-small-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, "source-49.pptx");
  await fs.writeFile(input, await sourceDeck(49));
  await assert.rejects(
    runLargeDeckAcceptance({ inputFile: input, projectDir: path.join(root, "project") }),
    (error) => error.code === "ACCEPTANCE_DECK_TOO_SMALL"
  );
});

async function sourceDeck(count) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  for (let page = 1; page <= count; page += 1) {
    zip.file(`ppt/slides/slide${page}.xml`, `<p:sld><a:t>Page ${page}: evidence-led message</a:t>${[1, 2, 3, 4, 5].map((item) => `<a:t>Supporting fact ${page}.${item}</a:t>`).join("")}</p:sld>`);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
