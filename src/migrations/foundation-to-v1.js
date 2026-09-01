import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CONTRACT_VERSION, createV1Entity as entity, pageSpecId as pageId, validateV1Bundle } from "../contracts/v1.js";
import { resolveProjectPath } from "../core/project.js";

export async function migrateFoundationProject(projectDir) {
  const root = path.resolve(projectDir);
  const [legacyProject, legacyPages, legacyTheme, legacyAssets] = await Promise.all([
    readJson(path.join(root, "project.json")), readJson(path.join(root, "pages.json")),
    readJson(path.join(root, "theme.json")), readJson(path.join(root, "assets.json"))
  ]);
  if (legacyProject.contract_version === CONTRACT_VERSION) throw new Error("project already uses the V1 contract");

  const warnings = [];
  const sources = await Promise.all((legacyProject.source_files ?? []).map(async (file, index) => {
    const metadata = await fileMetadata(root, file);
    return entity("source", `source-${String(index + 1).padStart(3, "0")}`, { file, ...metadata });
  }));
  const sourceByFile = new Map(sources.map((source) => [source.file, source.id]));
  const assets = await Promise.all((legacyAssets ?? []).map(async (asset) => {
    const metadata = await fileMetadata(root, asset.file);
    if (!asset.alt) warnings.push({ code: "ASSET_ALT_MISSING", subject_id: asset.id, field: "alt" });
    return entity("asset", asset.id, { type: asset.type, file: asset.file, alt: asset.alt ?? "", ...metadata, provenance: { migrated_from: "foundation" } });
  }));
  const pages = (legacyPages ?? []).map((page) => {
    const [sourceFile, locator] = (page.source ?? "").split("#", 2);
    const sourceId = sourceByFile.get(sourceFile);
    if (!sourceId) warnings.push({ code: "PAGE_SOURCE_UNRESOLVED", subject_id: pageId(page.page), field: "source_refs" });
    return entity("page_spec", pageId(page.page), {
      page: page.page, task: page.task, three_second_message: page.three_second_message,
      relation: page.relation, screen_text: page.screen_text, visual_job: page.visual_job,
      source_refs: sourceId ? [{ source_id: sourceId, locator: locator ? `#${locator}` : "" }] : [],
      asset_slots: page.asset_slots ?? [], content_status: page.status ?? "draft",
      renderers: { html: page.html ?? {}, pptx: page.pptx ?? {} }
    });
  });
  const outline = entity("outline", "outline-main", { sections: [{ id: "section-main", title: legacyProject.title, page_ids: pages.map(({ id }) => id) }] });
  const theme = entity("theme", "theme-default", { tokens: legacyTheme });
  const project = entity("project", legacyProject.name, {
    title: legacyProject.title, format: legacyProject.format, outputs: legacyProject.outputs,
    source_ids: sources.map(({ id }) => id), outline_id: outline.id, theme_id: theme.id,
    asset_ids: assets.map(({ id }) => id)
  });
  const bundle = { project, sources, outline, pages, theme, assets, templates: [], candidates: [], approvals: [], versions: [], builds: [], reviews: [], handoffs: [] };
  const errors = validateV1Bundle(bundle);
  if (errors.length) throw new Error(`migration produced an invalid V1 bundle:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return { contract_version: CONTRACT_VERSION, bundle, warnings: warnings.sort(compareWarnings) };
}

export async function writeMigratedProject(sourceDir, destinationDir) {
  const destination = path.resolve(destinationDir);
  await assertEmptyOrMissing(destination);
  const result = await migrateFoundationProject(sourceDir);
  await fs.mkdir(destination, { recursive: true });
  const managedFiles = [
    ...result.bundle.sources.map(({ file }) => file),
    ...result.bundle.assets.map(({ file }) => file)
  ];
  for (const relativeFile of [...new Set(managedFiles)].sort()) {
    const sourceFile = resolveProjectPath(path.resolve(sourceDir), relativeFile);
    const destinationFile = resolveProjectPath(destination, relativeFile);
    await fs.mkdir(path.dirname(destinationFile), { recursive: true });
    await fs.copyFile(sourceFile, destinationFile, fsConstants.COPYFILE_EXCL);
  }
  await Promise.all([
    writeJson(path.join(destination, "project.json"), result.bundle.project),
    writeJson(path.join(destination, "sources.json"), result.bundle.sources),
    writeJson(path.join(destination, "outline.json"), result.bundle.outline),
    writeJson(path.join(destination, "pages.json"), result.bundle.pages),
    writeJson(path.join(destination, "theme.json"), result.bundle.theme),
    writeJson(path.join(destination, "assets.json"), result.bundle.assets),
    writeJson(path.join(destination, "templates.json"), result.bundle.templates),
    writeJson(path.join(destination, "migration-warnings.json"), result.warnings)
  ]);
  return { ...result, destination };
}

async function fileMetadata(root, relativePath) {
  const file = resolveProjectPath(root, relativePath);
  const contents = await fs.readFile(file);
  return { bytes: contents.byteLength, mime: mimeFor(relativePath), sha256: crypto.createHash("sha256").update(contents).digest("hex") };
}
function mimeFor(file) {
  const extension = path.extname(file).toLowerCase();
  return ({ ".md": "text/markdown", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".json": "application/json" })[extension] ?? "application/octet-stream";
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); }
async function assertEmptyOrMissing(root) {
  try { if ((await fs.readdir(root)).length) throw new Error(`destination directory is not empty: ${root}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
function compareWarnings(left, right) { return `${left.code}:${left.subject_id}`.localeCompare(`${right.code}:${right.subject_id}`); }
