import fs from "node:fs/promises";
import path from "node:path";
import { initializeProject } from "../../src/core/init.js";

export async function persistedPackProject(root, model = "v1") {
  await initializeProject(root, { name: "pack-demo", title: "Resource reuse" });
  const read = async (file) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
  const write = async (file, value) => fs.writeFile(path.join(root, file), JSON.stringify(value, null, 2));
  let project = await read("project.json");
  const [page] = await read("pages.json");
  page.design_system_layout_id = "layout-cover";
  page.screen_text.body = ["One reusable resource"];
  const pages = [page, { ...structuredClone(page), id: "page-002", page: 2, screen_text: { title: "Reuse on another page", body: [] } }];
  if (model === "foundation") {
    project = { schema_version: "1.0", name: "pack-demo", title: "Resource reuse", format: "16:9", source_files: ["brief.md"], theme_file: "theme.json", assets_file: "assets.json", outputs: ["html", "pptx"] };
    await write("theme.json", (await read("theme.json")).tokens);
    for (const item of pages) { item.status = "approved"; item.source = "brief.md"; for (const key of ["contract_version", "kind", "id", "source_refs", "content_status", "renderers"]) delete item[key]; }
  } else {
    const outline = await read("outline.json"); outline.sections[0].page_ids.push("page-002"); await write("outline.json", outline);
  }
  project.design_system_pack_file = "pack.json";
  const pack = {
    contract_version: "1.0", kind: "design_system_pack", id: "pack-blue", name: "Blue",
    tokens: { colors: { accent: "#0057FF" }, typography: {}, spacing: {} },
    components: [{ id: "component-tag", type: "label", text: "Reusable safety label" }],
    layouts: [{ id: "layout-cover", semantic_family: "hero", template_id: "template-hero", component_ids: ["component-tag"], asset_ids: ["asset-mark"], renderers: { html: "html-pack-split", pptx: "pptx-pack-split" } }],
    assets: [{ id: "asset-mark", type: "illustration", source: "assets/mark.png", alt: "Synthetic blue mark" }]
  };
  // Tiny synthetic PNG; no remote data or provider calls.
  await fs.writeFile(path.join(root, "assets/mark.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQ0AAAgDsLnEvxKmgoOkSf8ms7cEAoFAIBAIBALBl6B17VhMf9oIMwAAAABJRU5ErkJggg==", "base64"));
  await write("project.json", project); await write("pages.json", pages); await write("pack.json", pack);
  return { pack, project, pages, write };
}
