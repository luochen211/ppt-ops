import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ApplicationService } from "../application/service.js";
import { initializeProject } from "../core/init.js";
import { SourceIntake } from "../sources/intake.js";

export async function runLargeDeckAcceptance({ inputFile, projectDir, render = false, prepareBoundaryImages }) {
  const started = performance.now();
  await initializeProject(projectDir, { name: "large-deck-acceptance", title: "Large Deck Acceptance" });
  const service = await ApplicationService.open(projectDir);
  const previous = process.env.PPT_OPS_RENDER_QA;
  try {
    const intake = await new SourceIntake({ projectRoot: projectDir, store: service.store, projectId: service.projectId }).importFile(inputFile);
    const slides = groupSlides(intake.extracted.segments);
    if (slides.length < 50) throw coded("ACCEPTANCE_DECK_TOO_SMALL", `expected at least 50 slides with extractable content, received ${slides.length}`);
    await migratePages(projectDir, intake.source, slides);
    if (prepareBoundaryImages) await prepareBoundaryImages(projectDir);
    await service.refresh();
    const freezeStarted = performance.now();
    const version = await service.freezeVersion();
    const buildStarted = performance.now();
    const { build, artifacts } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
    const reviewStarted = performance.now();
    process.env.PPT_OPS_RENDER_QA = render ? "1" : "0";
    const review = await service.runReview(build.id);
    return {
      input: { file: path.resolve(inputFile), sha256: intake.source.sha256, slide_count: slides.length },
      project: path.resolve(projectDir),
      version: { id: version.id, snapshot_hash: version.snapshot_hash },
      build: { id: build.id, state: build.state, artifacts },
      review: { id: review.review.id, state: review.review.state, passed: review.report.passed, automated_checks: review.report.automated_checks, acceptance: review.report.acceptance },
      performance_ms: {
        total: round(performance.now() - started),
        freeze: round(buildStarted - freezeStarted),
        build: round(reviewStarted - buildStarted),
        review: round(performance.now() - reviewStarted)
      }
    };
  }
  finally {
    if (previous === undefined) delete process.env.PPT_OPS_RENDER_QA; else process.env.PPT_OPS_RENDER_QA = previous;
    service.close();
  }
}

async function migratePages(projectDir, source, slides) {
  const [project, outline] = await Promise.all(["project.json", "outline.json"].map((file) => fs.readFile(path.join(projectDir, file), "utf8").then(JSON.parse)));
  const pages = slides.map((slide, index) => ({
    contract_version: "1.0", kind: "page_spec", id: `page-${String(index + 1).padStart(3, "0")}`, page: index + 1,
    task: `Preserve the source meaning of slide ${index + 1}`, three_second_message: slide.text.slice(0, 120) || `Slide ${index + 1}`,
    relation: index === 0 ? "hero" : "sequence", screen_text: { title: slide.text.slice(0, 120) || `Slide ${index + 1}`, body: slide.details.slice(0, 3) },
    visual_job: "Render a clear editable source-faithful page", source_refs: [{ source_id: source.id, locator: slide.locator }],
    asset_slots: [], content_status: "draft", renderers: { html: {}, pptx: {} }
  }));
  project.source_ids = [source.id];
  outline.sections = [{ id: "section-imported", title: "Imported deck", page_ids: pages.map(({ id }) => id) }];
  await Promise.all([
    writeJson(path.join(projectDir, "project.json"), project),
    writeJson(path.join(projectDir, "sources.json"), [source]),
    writeJson(path.join(projectDir, "outline.json"), outline),
    writeJson(path.join(projectDir, "pages.json"), pages)
  ]);
}
function groupSlides(segments) {
  const groups = new Map();
  for (const segment of segments) {
    const match = segment.locator.match(/^\/slides\/(\d+)\/text\/\d+$/);
    if (!match) continue;
    const page = Number(match[1]);
    const current = groups.get(page) ?? [];
    current.push(segment.text);
    groups.set(page, current);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([page, texts]) => ({ locator: `#/slides/${page}`, text: texts[0] ?? "", details: texts.slice(1) }));
}
async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
function round(value) { return Math.round(value * 100) / 100; }
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
