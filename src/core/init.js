import fs from "node:fs/promises";
import path from "node:path";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export async function initializeProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const name = options.name ?? path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const title = options.title ?? humanizeName(name);
  if (!NAME_PATTERN.test(name)) throw new Error("--name must be a stable lowercase identifier");

  await assertEmptyOrMissing(root);
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  const files = {
    "project.json": { schema_version: "1.0", name, title, format: "16:9", source_files: ["brief.md"], theme_file: "theme.json", assets_file: "assets.json", outputs: ["html", "pptx"] },
    "pages.json": [starterPage(title)],
    "theme.json": defaultTheme(),
    "assets.json": []
  };
  await Promise.all(Object.entries(files).map(([file, contents]) => writeJson(path.join(root, file), contents)));
  await fs.writeFile(path.join(root, "brief.md"), `# ${title}\n\nDescribe the audience, setting, goal, source facts, and delivery constraints here.\n`, { flag: "wx" });
  return { root, name, title, files: [...Object.keys(files), "brief.md", "assets/"] };
}

async function assertEmptyOrMissing(root) {
  try {
    const entries = await fs.readdir(root);
    if (entries.length > 0) throw new Error(`project directory is not empty: ${root}`);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}

async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); }
function humanizeName(name) { return name.split(/[._-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
function starterPage(title) {
  return { page: 1, source: "brief.md", task: "Establish the presentation promise", three_second_message: title, relation: "hero", screen_text: { title, body: ["Replace this starter content with approved source material."] }, visual_job: "Create one clear entry point for the audience", asset_slots: [], status: "draft" };
}
function defaultTheme() {
  return { dimensions: { width: 13.333, height: 7.5 }, typography: { heading_font: "Aptos Display", body_font: "Aptos" }, colors: { background: "#F7F5F0", text: "#171717", accent: "#D95D39" }, spacing: { unit: 0.25, page_margin: 0.6 } };
}
