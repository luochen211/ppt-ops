import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { readProject } from "../src/core/project.js";
import { validateV1Entity } from "../src/contracts/v1.js";
import { writeMigratedProject } from "../src/migrations/foundation-to-v1.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

process.env.PPT_OPS_RENDER_QA = "0";
for (const [number, mode] of [[6, "live_talk"], [7, "workshop"]]) {
  test(`${mode} golden workflow preserves authored notes through frozen dual-format build and review`, async (t) => {
    const fixture = JSON.parse(await fs.readFile(new URL(`fixtures/golden-conversations/0${number}-${mode}.json`, import.meta.url), "utf8"));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-golden-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await initializeProject(root, { name: mode.replaceAll("_", "-"), title: "Delivery example", deliveryMode: mode });
    const [starter] = JSON.parse(await fs.readFile(path.join(root, "pages.json"), "utf8"));
    const pages = [1, 2, 3].map((page) => ({ ...structuredClone(starter), id: `page-00${page}`, page,
      screen_text: { title: `Step ${page}` }, estimated_duration_seconds: 60,
      speaker_notes: `${fixture.speaker_notes}\nPage ${page} script.`,
      ...(page === 2 && fixture.interaction ? { audience_interaction: fixture.interaction } : {})
    }));
    await fs.writeFile(path.join(root, "pages.json"), JSON.stringify(pages));
    const outline = JSON.parse(await fs.readFile(path.join(root, "outline.json"), "utf8"));
    outline.sections[0].page_ids = pages.map(({ id }) => id);
    await fs.writeFile(path.join(root, "outline.json"), JSON.stringify(outline));
    await seedAcceptedBoundaryImages(root);
    const normalized = await readProject(root);
    assert.equal(normalized.pages[1].speaker_notes, pages[1].speaker_notes);
    const service = await ApplicationService.open(root);
    t.after(() => service.close());
    const version = await service.freezeVersion();
    const before = await fs.readFile(path.join(root, "pages.json"), "utf8");
    const { build } = await service.createBuild({ versionId: version.id, targets: ["html", "pptx"] });
    assert.equal(build.state, "succeeded");
    const folder = path.join(root, ".pptops", "builds", build.id);
    const html = await fs.readFile(path.join(folder, "html", "slides.html"), "utf8");
    assert.doesNotMatch(html.match(/<main[\s\S]*?<\/main>/)[0], /Speaker-only detail|Page 2 script/);
    assert.match(html, /<aside id="speaker-notes" hidden/);
    assert.match(html, /href="\?view=notes"/);
    assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(folder, "pptx", "slides.pptx")));
    for (const page of [1, 2, 3]) {
      assert.doesNotMatch(await zip.file(`ppt/slides/slide${page}.xml`).async("string"), /Speaker-only detail|script\./);
      const notes = await zip.file(`ppt/notesSlides/notesSlide${page}.xml`).async("string");
      assert.match(notes, new RegExp(`Page ${page} script`));
      assert.match(notes, /Speaker-only detail/);
    }
    const { report } = await service.runReview(build.id);
    assert.equal(report.automated_checks.find(({ id }) => id === "delivery-mode-fit").status, "passed");
    assert.ok(report.acceptance.every(({ status }) => status === "pending"));
    assert.equal(await fs.readFile(path.join(root, "pages.json"), "utf8"), before);
  });
}

test("Foundation migration retains notes, and V1 rejects non-text notes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-notes-migration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await fs.cp(path.resolve("examples/demo-project"), source, { recursive: true });
  const pages = JSON.parse(await fs.readFile(path.join(source, "pages.json"), "utf8"));
  pages[0].speaker_notes = "Retain my authored opening.";
  await fs.writeFile(path.join(source, "pages.json"), JSON.stringify(pages));
  const target = path.join(root, "v1");
  await writeMigratedProject(source, target);
  const normalized = await readProject(target);
  assert.equal(normalized.pages[0].speaker_notes, pages[0].speaker_notes);
  assert.ok(validateV1Entity({ ...normalized.contracts.pages[0], speaker_notes: {} }, "page_spec").includes("speaker_notes must be a non-empty string"));
});
