import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

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
  for (const page of project.pages) renderSlide(pptx, page, project.theme);

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

function renderSlide(pptx, page, theme) {
  const slide = pptx.addSlide();
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const colors = normalizeColors(theme.colors);
  const headingFont = theme.typography.heading_font;
  const bodyFont = theme.typography.body_font;

  slide.background = { color: colors.background };
  addShape(slide, pptx.ShapeType.rect, {
    x: margin, y: margin, w: 0.12, h: 0.72,
    fill: { color: colors.accent }, line: { color: colors.accent }, objectName: "Theme accent"
  });
  addText(slide, page.screen_text.title, {
    x: margin + 0.28, y: margin - 0.02, w: width - (margin * 2) - 0.28, h: 0.82,
    fontFace: headingFont, fontSize: 28, bold: true, color: colors.text,
    margin: 0, fit: "shrink", valign: "mid", objectName: `Slide ${page.page} title`
  });

  const body = bodyLines(page.screen_text);
  if (body.length > 0) renderBody(slide, pptx, body, theme, colors, bodyFont);
  else renderMessage(slide, pptx, page.three_second_message, theme, colors, bodyFont);

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

function renderBody(slide, pptx, lines, theme, colors, bodyFont) {
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const gap = Math.max(theme.spacing.unit, 0.18);
  const top = 1.72;
  const availableWidth = width - (margin * 2);
  const availableHeight = height - top - margin - 0.58;
  const columns = lines.length === 2 ? 2 : 1;
  const cardWidth = (availableWidth - (gap * (columns - 1))) / columns;
  const rows = Math.ceil(lines.length / columns);
  const cardHeight = Math.min(1.55, (availableHeight - (gap * (rows - 1))) / rows);

  lines.forEach((line, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const geometry = {
      x: margin + (column * (cardWidth + gap)),
      y: top + (row * (cardHeight + gap)),
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
      bold: columns === 2, margin: 0.28, fit: "shrink", valign: "mid",
      objectName: `Body text ${index + 1}`
    });
  });
}

function renderMessage(slide, pptx, message, theme, colors, bodyFont) {
  const { width } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  addShape(slide, pptx.ShapeType.roundRect, {
    x: margin, y: 2.1, w: width - (margin * 2), h: 2.35,
    fill: { color: colors.accent, transparency: 88 },
    line: { color: colors.accent, transparency: 45, width: 1.5 },
    objectName: "Message panel"
  });
  addText(slide, message, {
    x: margin + 0.45, y: 2.35, w: width - (margin * 2) - 0.9, h: 1.85,
    fontFace: bodyFont, fontSize: 24, color: colors.text, margin: 0,
    fit: "shrink", valign: "mid", align: "center", objectName: "Message text"
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
