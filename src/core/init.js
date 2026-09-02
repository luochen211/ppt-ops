import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createV1Entity as entity, pageSpecId as pageId, validateV1Bundle } from "../contracts/v1.js";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export async function initializeProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const name = options.name ?? path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const title = options.title ?? humanizeName(name);
  if (!NAME_PATTERN.test(name)) throw new Error("--name must be a stable lowercase identifier");
  await assertEmptyOrMissing(root);
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  const brief = `# ${title}\n\nDescribe the audience, setting, goal, source facts, and delivery constraints here.\n`;
  await fs.writeFile(path.join(root, "brief.md"), brief, { flag: "wx" });
  const source = entity("source", "source-001", { file: "brief.md", bytes: Buffer.byteLength(brief), mime: "text/markdown", sha256: crypto.createHash("sha256").update(brief).digest("hex") });
  const page = entity("page_spec", pageId(1), {
    page: 1, task: "Establish the presentation promise", three_second_message: title, relation: "hero",
    screen_text: { title },
    visual_job: "Create one clear entry point for the audience", source_refs: [{ source_id: source.id, locator: "" }],
    asset_slots: [], content_status: "draft", renderers: { html: {}, pptx: {} }
  });
  const outline = entity("outline", "outline-main", { sections: [{ id: "section-main", title, page_ids: [page.id] }] });
  const theme = entity("theme", "theme-default", { tokens: defaultTheme() });
  const project = entity("project", name, { title, format: "16:9", outputs: ["html", "pptx"], source_ids: [source.id], outline_id: outline.id, theme_id: theme.id, asset_ids: [] });
  const bundle = { project, sources: [source], outline, pages: [page], theme, assets: [], templates: [], candidates: [], approvals: [], versions: [], builds: [], reviews: [], handoffs: [] };
  const errors = validateV1Bundle(bundle);
  if (errors.length) throw new Error(`starter project is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  const files = { "project.json": project, "sources.json": bundle.sources, "outline.json": outline, "pages.json": bundle.pages, "theme.json": theme, "assets.json": [], "templates.json": [] };
  await Promise.all(Object.entries(files).map(([file, contents]) => writeJson(path.join(root, file), contents)));
  return { root, name, title, contract_version: "1.0", files: [...Object.keys(files), "brief.md", "assets/"] };
}

async function assertEmptyOrMissing(root) {
  try { if ((await fs.readdir(root)).length > 0) throw new Error(`project directory is not empty: ${root}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); }
function humanizeName(name) { return name.split(/[._-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
function defaultTheme() { return { dimensions: { width: 13.333, height: 7.5 }, typography: { heading_font: "Aptos Display", body_font: "Aptos" }, colors: { background: "#F7F5F0", text: "#171717", accent: "#D95D39" }, spacing: { unit: 0.25, page_margin: 0.6 } }; }
