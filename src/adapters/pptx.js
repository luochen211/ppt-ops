import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { resolveProjectPath } from "../core/project.js";
import { compileProjectLayout } from "../layout/catalog.js";

const EMU_PER_INCH = 914400;

/** Render a normalized shared project to an editable PowerPoint file. */
export async function buildPptx(project, outputFile) {
  if (!project?.project || !project?.theme || !Array.isArray(project?.pages)) {
    throw new TypeError("buildPptx requires a normalized project");
  }
  if (typeof outputFile !== "string" || outputFile.trim() === "") {
    throw new TypeError("buildPptx requires an output file");
  }

  const pptx = createPresentation(project);
  const plans = compileProjectLayout(project);
  for (const [index, page] of project.pages.entries()) renderSlide(pptx, page, plans[index], project, index, project.pages.length);

  const resolvedOutput = path.resolve(outputFile);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await pptx.writeFile({ fileName: resolvedOutput, compression: true });

  const validation = await validatePptx(resolvedOutput, project.pages.length);
  return {
    format: "pptx",
    outputFile: resolvedOutput,
    editable: true,
    slideCount: validation.slideCount,
    checks: validation.checks
  };
}

export async function validatePptx(fileOrBuffer, expectedSlideCount) {
  const bytes = typeof fileOrBuffer === "string" ? await fs.readFile(fileOrBuffer) : fileOrBuffer;
  const zip = await JSZip.loadAsync(bytes);
  const requiredEntries = ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"];
  for (const entry of requiredEntries) {
    if (!zip.file(entry)) throw new Error(`invalid PPTX: missing ${entry}`);
  }

  const slideEntries = Object.keys(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  if (slideEntries.length !== expectedSlideCount) {
    throw new Error(`invalid PPTX: expected ${expectedSlideCount} slides, found ${slideEntries.length}`);
  }
  slideEntries.forEach((entry, index) => {
    if (slideNumber(entry) !== index + 1) throw new Error(`invalid PPTX: non-contiguous slide entry ${entry}`);
  });

  const presentationXml = await zip.file("ppt/presentation.xml").async("string");
  const declaredSlides = (presentationXml.match(/<p:sldId\b/g) ?? []).length;
  if (declaredSlides !== expectedSlideCount) {
    throw new Error(`invalid PPTX: presentation declares ${declaredSlides} slides, expected ${expectedSlideCount}`);
  }
  assertWideLayout(presentationXml);

  for (const entry of slideEntries) {
    const xml = await zip.file(entry).async("string");
    assertNonNegativeGeometry(xml, entry);
  }

  return {
    slideCount: slideEntries.length,
    checks: {
      archiveStructure: true,
      slideCount: true,
      wideLayout: true,
      nonNegativeGeometry: true
    }
  };
}

function createPresentation(project) {
  const pptx = new PptxGenJS();
  const { width, height } = project.theme.dimensions;
  pptx.defineLayout({ name: "PPT_OPS_WIDE", width, height });
  pptx.layout = "PPT_OPS_WIDE";
  pptx.author = "PPT-Ops";
  pptx.subject = project.project.title;
  pptx.title = project.project.title;
  pptx.company = "PPT-Ops";
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: project.theme.typography.heading_font,
    bodyFontFace: project.theme.typography.body_font
  };
  return pptx;
}

function renderSlide(pptx, page, plan, project, index, count) {
  const theme = plan.theme;
  const slide = pptx.addSlide();
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const colors = normalizeColors(theme.colors);
  const headingFont = theme.typography.heading_font;
  const bodyFont = theme.typography.body_font;

  slide.background = { color: colors.background };
  const assets = resolveSlideAssets(page, project);
  if (index === 0 || index === count - 1) {
    renderBoundarySlide(slide, pptx, page, assets, theme, colors, headingFont);
    return;
  }
  addShape(slide, pptx.ShapeType.rect, {
    x: margin, y: margin, w: 0.12, h: 0.72,
    fill: { color: colors.accent }, line: { color: colors.accent }, objectName: "Theme accent"
  });
  addText(slide, page.screen_text.title, {
    ...plan.geometry.title,
    fontFace: headingFont, fontSize: 28, bold: true, color: colors.text,
    margin: 0, valign: "mid", objectName: `Slide ${page.page} ${plan.renderer.pptx} title`
  });

  const contentBox = contentGeometry(theme, assets.length > 0);
  const body = bodyLines(page.screen_text);
  if (body.length > 0) renderBody(slide, pptx, body, theme, colors, bodyFont, contentBox.copy);
  else renderMessage(slide, pptx, page.three_second_message, theme, colors, bodyFont, contentBox.copy);
  if (assets.length > 0) renderAssets(slide, assets, contentBox.assets);

  addShape(slide, pptx.ShapeType.line, {
    x: margin, y: height - margin - 0.18, w: width - (margin * 2), h: 0,
    line: { color: colors.accent, transparency: 35, width: 1 }, objectName: "Footer rule"
  });
  addText(slide, String(page.page), {
    x: width - margin - 0.42, y: height - margin - 0.15, w: 0.42, h: 0.2,
    fontFace: bodyFont, fontSize: 9, color: colors.text, transparency: 25,
    margin: 0, align: "right", objectName: `Slide ${page.page} number`
  });
}

function renderBoundarySlide(slide, pptx, page, assets, theme, colors, headingFont) {
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  if (assets.length > 0) {
    renderAssets(slide, assets, { x: width * 0.36, y: 0.08, w: width * 0.64, h: height - 0.16 });
  }
  addShape(slide, pptx.ShapeType.rect, {
    x: 0, y: height * 0.2, w: width * 0.49, h: height * 0.6,
    fill: { color: colors.background, transparency: 8 },
    line: { color: colors.background, transparency: 100, width: 0 },
    objectName: `Boundary title support ${page.page}`
  });
  addText(slide, page.screen_text.title, {
    x: margin, y: height * 0.25, w: width * 0.43, h: height * 0.5,
    fontFace: headingFont, fontSize: 34, bold: true, color: colors.text,
    margin: 0, valign: "mid", breakLine: false, fit: "shrink",
    objectName: `Boundary slide ${page.page} title`
  });
}

function renderBody(slide, pptx, lines, theme, colors, bodyFont, bounds) {
  const gap = Math.max(theme.spacing.unit, 0.18);
  const availableWidth = bounds.w;
  const availableHeight = bounds.h;
  const columns = lines.length === 2 ? 2 : 1;
  const cardWidth = (availableWidth - (gap * (columns - 1))) / columns;
  const rows = Math.ceil(lines.length / columns);
  const cardHeight = Math.min(1.55, (availableHeight - (gap * (rows - 1))) / rows);

  lines.forEach((line, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const geometry = {
      x: bounds.x + (column * (cardWidth + gap)),
      y: bounds.y + (row * (cardHeight + gap)),
      w: cardWidth,
      h: cardHeight
    };
    addShape(slide, pptx.ShapeType.roundRect, {
      ...geometry,
      fill: { color: colors.background },
      line: { color: colors.accent, transparency: 20, width: 1.25 },
      shadow: { type: "outer", color: colors.text, opacity: 0.1, blur: 1, angle: 45, distance: 1 },
      objectName: `Body card ${index + 1}`
    });
    addText(slide, line, {
      ...geometry,
      fontFace: bodyFont, fontSize: columns === 2 ? 21 : 19, color: colors.text,
      bold: columns === 2, margin: 0.28, valign: "mid",
      objectName: `Body text ${index + 1}`
    });
  });
}

function renderMessage(slide, pptx, message, theme, colors, bodyFont, bounds) {
  const panelHeight = Math.min(2.35, bounds.h);
  addShape(slide, pptx.ShapeType.roundRect, {
    x: bounds.x, y: bounds.y + Math.max(0, (bounds.h - panelHeight) / 2), w: bounds.w, h: panelHeight,
    fill: { color: colors.accent, transparency: 88 },
    line: { color: colors.accent, transparency: 45, width: 1.5 },
    objectName: "Message panel"
  });
  addText(slide, message, {
    x: bounds.x + 0.35, y: bounds.y + Math.max(0, (bounds.h - panelHeight) / 2) + 0.25, w: bounds.w - 0.7, h: panelHeight - 0.5,
    fontFace: bodyFont, fontSize: 24, color: colors.text, margin: 0,
    valign: "mid", align: "center", objectName: "Message text"
  });
}

function contentGeometry(theme, hasAssets) {
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const content = { x: margin, y: 1.72, w: width - (margin * 2), h: height - 1.72 - margin - 0.58 };
  if (!hasAssets) return { copy: content, assets: null };
  const gap = Math.max(theme.spacing.unit * 1.5, 0.38);
  const assetWidth = Math.min(4.55, content.w * 0.39);
  return {
    copy: { ...content, w: content.w - assetWidth - gap },
    assets: { x: content.x + content.w - assetWidth, y: content.y, w: assetWidth, h: content.h }
  };
}

function resolveSlideAssets(page, project) {
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  return (page.asset_slots ?? []).map((slot) => {
    const asset = byId.get(slot.asset_id);
    if (!asset) throw new Error(`unknown PPTX asset: ${slot.asset_id}`);
    const extension = path.extname(asset.file).toLowerCase();
    if (!(asset.mime?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".svg"].includes(extension))) throw new Error(`PPTX asset is not a supported image: ${asset.id}`);
    return { ...slot, asset, path: resolveProjectPath(project.root, asset.file) };
  });
}

function renderAssets(slide, assets, bounds) {
  const gap = 0.22;
  const itemHeight = (bounds.h - gap * (assets.length - 1)) / assets.length;
  assets.forEach(({ asset, path: imagePath, fit }, index) => {
    const geometry = { x: bounds.x, y: bounds.y + index * (itemHeight + gap), w: bounds.w, h: itemHeight };
    assertGeometry(geometry);
    slide.addImage({
      path: imagePath, ...geometry,
      sizing: { type: fit === "cover" ? "cover" : "contain", w: geometry.w, h: geometry.h },
      altText: asset.alt ?? asset.id,
      objectName: `Asset ${asset.id}`
    });
  });
}

function bodyLines(screenText) {
  if (Array.isArray(screenText.body)) return screenText.body;
  if (typeof screenText.subtitle === "string" && screenText.subtitle.trim()) return [screenText.subtitle];
  return [];
}

function addShape(slide, shape, options) {
  assertGeometry(options);
  slide.addShape(shape, options);
}

function addText(slide, text, options) {
  assertGeometry(options);
  slide.addText(text, options);
}

function assertGeometry({ x, y, w, h }) {
  for (const [key, value] of Object.entries({ x, y, w, h })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`PPTX geometry ${key} must be a non-negative finite number`);
    }
  }
}

function normalizeColors(colors) {
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, color.replace(/^#/, "").toUpperCase()]));
}

function slideNumber(entry) {
  return Number(entry.match(/slide(\d+)\.xml$/)?.[1]);
}

function assertWideLayout(xml) {
  const match = xml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!match) throw new Error("invalid PPTX: missing slide dimensions");
  const width = Number(match[1]) / EMU_PER_INCH;
  const height = Number(match[2]) / EMU_PER_INCH;
  if (Math.abs((width / height) - (16 / 9)) > 0.002) {
    throw new Error(`invalid PPTX: slide layout is not 16:9 (${width} x ${height})`);
  }
}

function assertNonNegativeGeometry(xml, entry) {
  const geometry = /<(?:a|p):(off|ext|chOff|chExt)\b[^>]*>/g;
  for (const tag of xml.matchAll(geometry)) {
    for (const coordinate of tag[0].matchAll(/\b(?:x|y|cx|cy)="(-?\d+)"/g)) {
      if (Number(coordinate[1]) < 0) throw new Error(`invalid PPTX: negative geometry in ${entry}`);
    }
  }
}
