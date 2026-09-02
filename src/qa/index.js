import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);
const POWERPOINT = "/Applications/Microsoft PowerPoint.app";

export async function inspectPresentation({ project, pptxFile, evidenceDir, render = true, commands = defaultCommands() }) {
  const structural = await inspectPptxStructure(pptxFile, project);
  const rendering = render ? await renderPresentation({ pptxFile, evidenceDir, commands }) : degradedRendering("rendering disabled");
  return {
    status: structural.findings.some(({ severity }) => severity === "error") ? "failed" : rendering.status === "rendered" ? "passed" : "degraded",
    findings: structural.findings,
    pages: structural.pages,
    rendering
  };
}

export async function inspectPptxStructure(pptxFile, project, options = {}) {
  const archive = await JSZip.loadAsync(await fs.readFile(pptxFile));
  const slideNames = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(numericSlideSort);
  const pages = [];
  const findings = [];
  for (const [index, name] of slideNames.entries()) {
    const page = index + 1;
    const xml = await archive.file(name).async("string");
    const shapes = parseShapes(xml);
    const declaredFonts = [...xml.matchAll(/typeface="([^"]+)"/g)].map((match) => match[1]);
    const pageFindings = [
      ...checkBounds(shapes, page),
      ...checkOverlap(shapes, page),
      ...checkFonts(project, declaredFonts, page),
      ...checkDensity(project.pages[index], shapes, page, options)
    ];
    findings.push(...pageFindings);
    pages.push({ page, checks: ["out-of-bounds", "unintended-overlap", "font-substitution", "density"], finding_count: pageFindings.length });
  }
  return { pages, findings };
}

export async function renderPresentation({ pptxFile, evidenceDir, commands = defaultCommands() }) {
  const output = path.resolve(evidenceDir);
  await fs.mkdir(output, { recursive: true });
  const pdfFile = path.join(output, "slides.pdf");
  const prefix = path.join(output, "page");
  let renderer;
  try {
    if (await exists(commands.powerpoint)) {
      renderer = "microsoft-powerpoint";
      const script = [
      'on run argv',
      'set inputFile to POSIX file (item 1 of argv)',
      'set outputFile to POSIX file (item 2 of argv)',
      'tell application "Microsoft PowerPoint"',
      'open inputFile',
      'set deck to active presentation',
      'save deck in outputFile as save as PDF',
      'close deck saving no',
      'end tell',
      'end run'
      ].join("\n");
      await withPowerPointLock(async () => {
        await fs.rm(pdfFile, { force: true });
        await commands.exec("osascript", ["-e", script, pptxFile, pdfFile]);
        await waitForFile(pdfFile);
      });
    } else if (commands.libreoffice && await exists(commands.libreoffice)) {
      renderer = "libreoffice";
      await commands.exec(commands.libreoffice, ["--headless", "--convert-to", "pdf", "--outdir", output, pptxFile]);
      const generated = path.join(output, `${path.basename(pptxFile, path.extname(pptxFile))}.pdf`);
      if (generated !== pdfFile) await fs.rename(generated, pdfFile);
    } else return degradedRendering("Microsoft PowerPoint and LibreOffice are unavailable");

    if (!await exists(commands.pdftoppm)) return degradedRendering("pdftoppm is unavailable", renderer);
    await commands.exec(commands.pdftoppm, ["-png", "-r", "144", pdfFile, prefix]);
    const images = (await fs.readdir(output)).filter((name) => /^page-\d+\.png$/.test(name)).sort(numericSlideSort).map((name) => path.join(output, name));
    if (images.length === 0) return degradedRendering("renderer produced no page images", renderer);
    let montage;
    if (await exists(commands.magick)) {
      montage = path.join(output, "montage.png");
      await commands.exec(commands.magick, [...images, "-thumbnail", "480x270", "+append", montage]);
    }
    return { status: "rendered", renderer, pdf_file: pdfFile, page_images: images, montage_file: montage };
  } catch (error) {
    return degradedRendering(`rendering failed: ${error.message}`, renderer);
  }
}

function parseShapes(xml) {
  const shapes = [];
  const pattern = /<p:(?:sp|pic|graphicFrame)\b[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>[\s\S]*?<\/p:(?:sp|pic|graphicFrame)>/g;
  for (const match of xml.matchAll(pattern)) {
    shapes.push({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]), hasText: /<a:t>/.test(match[0]), decorative: /<p:cNvPr[^>]+(?:name="(?:Background|Decorative)|descr="decorative")/i.test(match[0]) });
  }
  return shapes;
}
function checkBounds(shapes, page) {
  const width = 12191695; const height = 6858000;
  return shapes.filter((shape) => shape.x < 0 || shape.y < 0 || shape.x + shape.width > width || shape.y + shape.height > height)
    .map((shape) => finding(page, "out-of-bounds", "error", shape));
}
function checkOverlap(shapes, page) {
  const findings = [];
  for (let left = 0; left < shapes.length; left += 1) for (let right = left + 1; right < shapes.length; right += 1) {
    if (shapes[left].decorative || shapes[right].decorative) continue;
    if (shapes[left].hasText !== shapes[right].hasText) continue;
    const area = overlapArea(shapes[left], shapes[right]);
    const smaller = Math.min(shapes[left].width * shapes[left].height, shapes[right].width * shapes[right].height);
    if (smaller > 0 && area / smaller > 0.85) findings.push(finding(page, "unintended-overlap", "warning", { left, right, ratio: area / smaller }));
  }
  return findings;
}
function checkDensity(pageSpec, shapes, page, options) {
  const text = [pageSpec?.screen_text?.title, ...(pageSpec?.screen_text?.body ?? [])].filter(Boolean).join(" ");
  const limit = options.characterLimit ?? 700;
  return text.length > limit || shapes.length > (options.shapeLimit ?? 60)
    ? [finding(page, "density", "warning", { characters: text.length, shapes: shapes.length, character_limit: limit })] : [];
}
function checkFonts(project, declaredFonts, page) {
  const expected = [project.theme?.typography?.heading_font, project.theme?.typography?.body_font].filter(Boolean);
  return expected.filter((font) => !declaredFonts.includes(font)).map((font) => finding(page, "font-substitution", "warning", { expected_font: font, declared_fonts: [...new Set(declaredFonts)] }));
}
function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}
function finding(page, check, severity, evidence) { return { page, check, severity, evidence }; }
function degradedRendering(reason, renderer) { return { status: "degraded", renderer, reason, page_images: [] }; }
function numericSlideSort(left, right) { return Number(left.match(/(\d+)/)?.[1]) - Number(right.match(/(\d+)/)?.[1]); }
async function exists(file) { if (!file) return false; try { await fs.access(file); return true; } catch { return false; } }
function defaultCommands() {
  return { powerpoint: POWERPOINT, libreoffice: "/Applications/LibreOffice.app/Contents/MacOS/soffice", pdftoppm: "/opt/homebrew/bin/pdftoppm", magick: "/opt/homebrew/bin/magick", exec: (file, args) => execFileAsync(file, args) };
}
async function withPowerPointLock(operation) {
  const lock = path.join(os.tmpdir(), "ppt-ops-powerpoint-render.lock");
  const deadline = Date.now() + 30000;
  while (true) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("timed out waiting for PowerPoint renderer");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try { return await operation(); }
  finally { await fs.rm(lock, { recursive: true, force: true }); }
}
async function waitForFile(file) {
  const deadline = Date.now() + 10000;
  while (!await exists(file)) {
    if (Date.now() >= deadline) throw new Error("PowerPoint did not produce a PDF");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
