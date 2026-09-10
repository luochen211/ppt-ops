import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { VisualPreferenceProfileStore } from "./visual-profile.js";

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Extract structural observations only. Never return text, artwork, or style identity.
export async function observeReference(bytes) {
  if (bytes.length > 50 * 1024 * 1024) throw new Error("reference exceeds 50 MB");
  const zip = await JSZip.loadAsync(bytes);
  let expanded = 0;
  const entries = Object.values(zip.files);
  if (entries.length > 5000) throw new Error("reference archive has too many entries");
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    if (path.posix.isAbsolute(original) || original.split(/[\\/]/).includes("..")) throw new Error("unsafe reference archive path");
    const size = entry._data?.uncompressedSize ?? 0;
    expanded += size;
    if (size > 25 * 1024 * 1024 || expanded > 200 * 1024 * 1024) throw new Error("reference archive expansion limit exceeded");
  }
  if (!zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) throw new Error("reference must be a PPTX package");
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  const relationships = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  if (!relationships) throw new Error("reference is missing slide relationships");
  const attribute = (tag, key) => new RegExp(`(?:^|\\s)${key}="([^"<>]+)"`).exec(tag)?.[1];
  const targets = new Map();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    if (attribute(tag, "TargetMode") === "External") continue;
    targets.set(attribute(tag, "Id"), attribute(tag, "Target"));
  }
  const files = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = targets.get(attribute(match[0], "r:id"));
    const name = target?.startsWith("/") ? target.slice(1) : path.posix.normalize(`ppt/${target}`);
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(name) || !zip.file(name)) throw new Error("invalid reference slide relationship");
    files.push(zip.file(name));
  }
  if (!files.length) throw new Error("reference contains no slides");
  const pages = [];
  for (const file of files) {
    const xml = await file.async("string");
    pages.push({
      text_runs: [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].length,
      explicit_font_sizes: [...new Set([...xml.matchAll(/\bsz="(\d+)"/g)].map((m) => Number(m[1]) / 100))].sort((a, b) => a - b),
      pictures: [...xml.matchAll(/<p:pic[\s>]/g)].length,
      shapes: [...xml.matchAll(/<p:sp[\s>]/g)].length
    });
  }
  return [
    { property: "density", value: `Text-run counts per slide: ${pages.map((p) => p.text_runs).join(", ")}. Runs are not words or rendered lines.` },
    { property: "whitespace", value: "Requires rendered visual inspection; object counts cannot establish usable whitespace." },
    { property: "hierarchy", value: `Explicit font sizes in points per slide: ${JSON.stringify(pages.map((p) => p.explicit_font_sizes))}. Inherited theme sizes are unmeasured.` },
    { property: "imagery", value: `Native picture counts per slide: ${pages.map((p) => p.pictures).join(", ")}. Semantic roles require visual inspection.` },
    { property: "rhythm", value: `Slide sequence (text runs/pictures/shapes): ${pages.map((p) => `${p.text_runs}/${p.pictures}/${p.shapes}`).join("; ")}. This is structural variation, not a storytelling judgment.` },
    { property: "motif", value: "Recurring visual motifs require rendered inspection; no creator identity or artwork is extracted." }
  ];
}

export class VisualPreferenceWorkflow {
  constructor(repositoryRoot) {
    this.root = path.resolve(repositoryRoot);
    this.store = new VisualPreferenceProfileStore({ repositoryRoot: this.root });
  }

  async nominate({ id, file, actor, title }) {
    if (actor !== "user") throw new Error("explicit user action is required");
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id ?? "")) throw new Error("invalid reference id");
    if ((await this.store.load()).references.some((ref) => ref.id === id)) throw new Error(`reference already exists: ${id}`);
    if (path.extname(file).toLowerCase() !== ".pptx") throw new Error("reference must be a PPTX file");
    if ((await fs.stat(file)).size > 50 * 1024 * 1024) throw new Error("reference exceeds 50 MB");
    const bytes = await fs.readFile(file);
    const observations = await observeReference(bytes);
    const sha256 = digest(bytes);
    const relative = `config/visual-references/${sha256}.pptx`;
    await fs.mkdir(path.dirname(path.join(this.root, relative)), { recursive: true });
    try { await fs.writeFile(path.join(this.root, relative), bytes, { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    if (digest(await fs.readFile(path.join(this.root, relative))) !== sha256) throw new Error("managed reference hash mismatch");
    const reference = await this.store.nominateReference({ id, file: relative, sha256, actor, title });
    return { reference, observations };
  }

  async observe(id) {
    const reference = (await this.store.load()).references.find((ref) => ref.id === id);
    if (!reference || reference.nominated_by !== "user") throw new Error(`unknown user-nominated reference: ${id}`);
    const file = await fs.realpath(path.resolve(this.root, reference.file));
    const root = await fs.realpath(this.root);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("reference escapes repository root");
    const bytes = await fs.readFile(file);
    if (digest(bytes) !== reference.sha256) throw new Error("reference hash mismatch; nominate changed content separately");
    return observeReference(bytes);
  }

  async propose(input) {
    if (!Array.isArray(input.reference_ids) || !input.reference_ids.length) throw new Error("reference_ids required");
    const observed_properties = [];
    for (const id of input.reference_ids) {
      observed_properties.push(...(await this.observe(id)).map((item) => ({ ...item, reference_id: id })));
    }
    for (const item of input.visual_observations ?? []) {
      if (!["density", "whitespace", "hierarchy", "imagery", "rhythm", "motif"].includes(item.property) ||
          typeof item.value !== "string" || !item.value.trim() || typeof item.evidence !== "string" || !item.evidence.trim() ||
          !input.reference_ids.includes(item.reference_id)) throw new Error("visual observations require dimension, value, nominated reference_id and rendered evidence locator");
      observed_properties.push({ property: item.property, value: item.value, reference_id: item.reference_id,
        evidence: item.evidence, observer: "agent", method: "rendered_visual_inspection" });
    }
    return this.store.proposeFromReference({ ...input, observed_properties });
  }

  async proposeFeedback(projectDir, input) {
    const { ApplicationService } = await import("../application/service.js");
    const service = await ApplicationService.open(projectDir);
    try {
      const feedback = service.store.listEntities(service.projectId, "candidate_feedback");
      return await this.store.proposeFromRepeatedFeedback({ ...input, feedback, project_id: service.projectId,
        observed_properties: [{ property: "repeated_feedback", value: `User rejections in project ${service.projectId}; fingerprint: ${input.root_cause_fingerprint}` }]
      });
    } finally { service.close(); }
  }

  async designContext(projectDir) {
    const { readProject } = await import("../core/project.js");
    const project = await readProject(projectDir);
    return { project: project.project.name, visual_preferences: await this.store.accepted() };
  }
}
