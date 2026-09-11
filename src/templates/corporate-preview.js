import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withHtmlPage } from "../qa/html.js";
import { resolveProjectPath } from "../core/project.js";
const exec = promisify(execFile);

export async function renderCorporateReference(service, inspection) {
  const { profile } = inspection;
  const source = resolveProjectPath(service.project.root, profile.source.file);
  const directory = `.pptops/templates/corporate/previews/${inspection.sha256}/${crypto.randomUUID()}`;
  let bytes, observations = [], status = "rendered", reason;
  if (profile.source.format === "html") {
    await withHtmlPage({ htmlFile: source, isolatedDocument: true }, async client => {
      const result = await client.send("Runtime.evaluate", { expression: `(() => ({ pages: [...document.querySelectorAll('section')].slice(0, 50).map((node, index) => { const style = getComputedStyle(node), box = node.getBoundingClientRect(); return { page: index + 1, font_family: style.fontFamily, color: style.color, background: style.backgroundColor, width: box.width, height: box.height }; }), blocked_images: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).length }))()`, returnByValue: true });
      observations = result.result.value;
      bytes = Buffer.from((await client.send("Page.captureScreenshot", { format: "png" })).data, "base64");
    });
    reason = "Scripts, network and local subresources are blocked. This is a contained static viewport, with computed section styles; missing external/local assets may change the reference appearance.";
  } else if (profile.source.format === "pdf") {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-corporate-pdf-"));
    try {
      const prefix = path.join(temporary, "page-1");
      await exec("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1600", "-png", source, prefix], { timeout: 30000, maxBuffer: 1024 * 1024 });
      bytes = await fs.readFile(`${prefix}.png`);
      reason = "Rendered first-page visual reference; no editable master or placeholder inference.";
    } catch (error) { status = "degraded"; reason = `PDF renderer unavailable or failed: ${error.code ?? error.message}`; }
    finally { await fs.rm(temporary, { recursive: true, force: true }); }
  } else {
    status = "degraded";
    reason = "Native template preview requires separately recorded PowerPoint inspection. This command does not open untrusted packages in an application.";
  }
  const screenshot = bytes ? { file: `${directory}/reference.png`, sha256: crypto.createHash("sha256").update(bytes).digest("hex") } : undefined;
  if (bytes) await service.files.writeImmutable(screenshot.file, bytes);
  const report = { source_sha256: profile.source.sha256, inspection_sha256: inspection.sha256, status, reason, observations, ...(screenshot ? { screenshot } : {}), evidence_type: "visual", real_powerpoint: "pending" };
  // Screenshots may differ across hosts; a new content-addressed report retains each observation.
  const reportFile = `${directory}/report-${crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex")}.json`;
  await service.files.writeImmutable(reportFile, JSON.stringify(report, null, 2) + "\n");
  return { ...report, report_file: reportFile };
}
