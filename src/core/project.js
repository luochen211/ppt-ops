import fs from "node:fs/promises";
import path from "node:path";

export async function readProject(projectDir) {
  const root = path.resolve(projectDir);
  const projectFile = path.join(root, "project.json");
  const pagesFile = path.join(root, "pages.json");
  const project = await readJson(projectFile);
  if (project.contract_version === "1.0" && project.kind === "project") return readV1Project(root, project, projectFile, pagesFile);
  const themeFile = resolveProjectPath(root, project.theme_file ?? "theme.json");
  const assetsFile = resolveProjectPath(root, project.assets_file ?? "assets.json");
  const [pages, theme, assets] = await Promise.all([readJson(pagesFile), readJson(themeFile), readJson(assetsFile)]);
  const referencedFiles = await inspectReferencedFiles(root, project, pages, assets);
  return { root, project, theme, assets, pages, referencedFiles, projectFile, pagesFile, themeFile, assetsFile, contractModel: "foundation" };
}

async function readV1Project(root, contract, projectFile, pagesFile) {
  const themeFile = path.join(root, "theme.json");
  const assetsFile = path.join(root, "assets.json");
  const [pageContracts, themeContract, assetContracts, sources, outline, templates] = await Promise.all([
    readJson(pagesFile), readJson(themeFile), readJson(assetsFile), readJson(path.join(root, "sources.json")),
    readJson(path.join(root, "outline.json")), readJson(path.join(root, "templates.json"))
  ]);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const project = { schema_version: "1.0", name: contract.id, title: contract.title, format: contract.format, source_files: sources.map(({ file }) => file), theme_file: "theme.json", assets_file: "assets.json", outputs: contract.outputs };
  const pages = pageContracts.map((page) => {
    const reference = page.source_refs?.[0];
    const source = reference ? sourceById.get(reference.source_id) : undefined;
    return { page: page.page, source: source ? `${source.file}${reference.locator ?? ""}` : undefined, task: page.task, three_second_message: page.three_second_message, relation: page.relation, screen_text: page.screen_text, visual_job: page.visual_job, asset_slots: page.asset_slots, status: page.content_status, html: page.renderers?.html, pptx: page.renderers?.pptx };
  });
  const theme = themeContract.tokens;
  const assets = assetContracts.map(({ contract_version, kind, sha256, bytes, mime, provenance, ...asset }) => asset);
  const referencedFiles = await inspectReferencedFiles(root, project, pages, assets);
  return { root, project, theme, assets, pages, referencedFiles, projectFile, pagesFile, themeFile, assetsFile, contractModel: "v1", contracts: { project: contract, sources, outline, pages: pageContracts, theme: themeContract, assets: assetContracts, templates } };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function inspectReferencedFiles(root, project, pages, assets) {
  const sources = new Set(project.source_files ?? []);
  for (const page of pages ?? []) if (typeof page.source === "string") sources.add(page.source.split("#", 1)[0]);
  const references = [
    ...[...sources].map((file) => ({ kind: "source", file })),
    ...(assets ?? []).map((asset) => ({ kind: "asset", id: asset.id, file: asset.file }))
  ];
  return Promise.all(references.map(async (reference) => {
    try {
      await fs.access(resolveProjectPath(root, reference.file));
      return { ...reference, exists: true };
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "PROJECT_PATH_OUTSIDE_ROOT"].includes(error.code)) return { ...reference, exists: false };
      throw error;
    }
  }));
}

export function resolveProjectPath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    const error = new Error("project reference must be a non-empty path");
    error.code = "PROJECT_PATH_OUTSIDE_ROOT";
    throw error;
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error(`project reference escapes project root: ${relativePath}`);
    error.code = "PROJECT_PATH_OUTSIDE_ROOT";
    throw error;
  }
  return resolved;
}

export function outputDir(project) {
  return path.join(project.root, "outputs");
}
