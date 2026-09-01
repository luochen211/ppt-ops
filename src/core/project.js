import fs from "node:fs/promises";
import path from "node:path";

export async function readProject(projectDir) {
  const root = path.resolve(projectDir);
  const projectFile = path.join(root, "project.json");
  const pagesFile = path.join(root, "pages.json");
  const [project, pages] = await Promise.all([
    readJson(projectFile),
    readJson(pagesFile)
  ]);
  return { root, project, pages, projectFile, pagesFile };
}

async function readJson(file) {
  const content = await fs.readFile(file, "utf8");
  return JSON.parse(content);
}

export function outputDir(project) {
  return path.join(project.root, "outputs");
}
