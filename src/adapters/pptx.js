import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { resolveProjectPath } from "../core/project.js";
import { renderNativeDiagram } from "./diagram.js";
import { assertAccessibleTextCapacity } from "../accessibility/index.js";
import { PACK_PPTX_RENDERERS } from "../templates/pack-renderers.js";
import { compileProjectLayout, materializeDesignSystemResources } from "../layout/catalog.js";
import { applyCitationManifest } from "../citations/manifest.js";
import { compileImageSemanticLayout } from "../layout/image-semantics.js";

import { detectRaster } from "../visual-assets/raster.js";
import { screenshotPlacement, visibleScreenshotRegion } from "../layout/screenshot.js";

const EMU_PER_INCH = 914400;

/** Render a normalized shared project to an editable PowerPoint file. */
export async function buildPptx(project, outputFile) {
  if (!project?.project || !project?.theme || !Array.isArray(project?.pages)) {
    throw new TypeError("buildPptx requires a normalized project");
  }
  if (typeof outputFile !== "string" || outputFile.trim() === "") {
    throw new TypeError("buildPptx requires an output file");
  }

  project = materializeDesignSystemResources(applyCitationManifest(project));
  assertAccessibleTextCapacity(project);
  project = { ...project, assets: await Promise.all(project.assets.map(async (asset) => {
    if (!(asset.mime?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".svg"].includes(path.extname(asset.file).toLowerCase()))) return asset;
    const bytes = await fs.readFile(resolveProjectPath(project.root, asset.file));
    let dimensions = detectRaster(bytes);
    if (!dimensions.supported && path.extname(asset.file).toLowerCase() === ".svg") {
      const viewBox = bytes.toString().match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)["']/);
      if (viewBox) dimensions = { width: Number(viewBox[1]), height: Number(viewBox[2]) };
    }
    if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error(`cannot measure image: ${asset.id}`);
    return { ...asset, image_dimensions: dimensions };
  })) };
  const pptx = createPresentation(project);
  const plans = compileProjectLayout(project);
  for (const [index, page] of project.pages.entries()) renderSlide(pptx, page, plans[index], project);

  const resolvedOutput = path.resolve(outputFile);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await pptx.writeFile({ fileName: resolvedOutput, compression: true });

  if (project.project.accessibility_profile?.enabled) {
    const archive = await JSZip.loadAsync(await fs.readFile(resolvedOutput));
    const core = await archive.file("docProps/core.xml").async("string");
    const language = String(project.project.accessibility_profile.document_language);
    archive.file("docProps/core.xml", core.replace("</cp:coreProperties>", `<dc:language>${language}</dc:language></cp:coreProperties>`));
    await fs.writeFile(resolvedOutput, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }
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
  pptx.lang = project.project.accessibility_profile?.document_language ?? "zh-CN";
  if (project.project.accessibility_profile?.enabled) pptx.rtlMode = project.project.accessibility_profile.reading_direction === "rtl";
  pptx.theme = {
    ...(project.project.accessibility_profile?.enabled ? { lang: project.project.accessibility_profile.document_language } : {}),
    headFontFace: project.theme.typography.heading_font,
    bodyFontFace: project.theme.typography.body_font
  };
  return pptx;
}

function renderSlide(pptx, page, plan, project) {
  const theme = plan.theme;
  const slide = pptx.addSlide();
  const profile = project.project.accessibility_profile;
  if (profile?.enabled) {
    const originalAddText = slide.addText.bind(slide);
    slide.addText = (text, options = {}) => {
      const size = options.objectName?.startsWith("Diagram ") && !options.objectName.startsWith("Diagram connector") ? 21 : options.fontSize ?? 18;
      return originalAddText(text, { ...options, lang: page.accessibility?.language ?? profile.document_language, rtlMode: profile.reading_direction === "rtl", fontSize: size * (profile.text_scale ?? 1), transparency: 0, fit: "none", shrinkText: false, autoFit: false });
    };
  }
  if (page.speaker_notes) slide.addNotes(page.speaker_notes);
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const colors = normalizeColors(theme.colors);
  const headingFont = theme.typography.heading_font;
  const bodyFont = theme.typography.body_font;

  slide.background = { color: colors.background };
  const assets = resolveSlideAssets(page, project);
  addShape(slide, pptx.ShapeType.rect, {
    x: margin, y: margin, w: 0.12, h: 0.72,
    fill: { color: colors.accent }, line: { color: colors.accent }, objectName: "Theme accent"
  });
  addText(slide, page.screen_text.title, {
    ...plan.geometry.title,
    fontFace: headingFont, fontSize: 28, bold: true, color: colors.text,
    margin: 0, valign: "mid", objectName: `Slide ${page.page} ${plan.renderer.pptx} title`
  });

  const components = plan.design_resources?.components ?? [];
  const mode = plan.design_system ? PACK_PPTX_RENDERERS[plan.renderer.pptx] : undefined;
  const contentBox = contentGeometry(theme, assets.length > 0, mode, components.length > 0);
  components.forEach((component, index) => addText(slide, component.text, {
    x: margin + index * ((width - margin * 2) / components.length), y: 1.5,
    w: (width - margin * 2) / components.length - 0.15, h: 0.4,
    fontFace: bodyFont, fontSize: 14, bold: true, color: colors.accent,
    margin: 0.04, line: { color: colors.accent, width: 1 },
    objectName: `Pack component ${component.id}`
  }));
  const body = bodyLines(page.screen_text);
  if (page.diagram) renderNativeDiagram(slide, page.diagram, contentBox.copy, theme, colors);
  else if (body.length > 0) renderBody(slide, pptx, body, theme, colors, bodyFont, contentBox.copy);
  else renderMessage(slide, pptx, page.three_second_message, theme, colors, bodyFont, contentBox.copy);
  if (assets.length > 0) renderAssets(slide, assets, contentBox.assets, bodyFont);
  renderCitationRegion(slide, page, theme, colors, bodyFont);

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

function renderCitationRegion(slide, page, theme, colors, bodyFont) {
  if (!page.citation_entries?.length) return;
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  addText(slide, page.citation_entries.map((entry) => `[${entry.number}] ${entry.public_label || entry.title || "Citation metadata pending"}`).join("  "), {
    x: margin, y: height - margin - 0.48, w: width - (margin * 2) - 0.55, h: 0.24,
    fontFace: bodyFont, fontSize: 8, color: colors.text, transparency: 12,
    margin: 0, valign: "mid", fit: "none", shrinkText: false, autoFit: false,
    objectName: `Slide ${page.page} citations`
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

function contentGeometry(theme, hasAssets, mode, hasComponents) {
  const { width, height } = theme.dimensions;
  const margin = theme.spacing.page_margin;
  const top = hasComponents ? 2.08 : 1.72;
  const content = { x: margin, y: top, w: width - (margin * 2), h: height - top - margin - 0.58 };
  if (!hasAssets) return { copy: content, assets: null };
  const gap = Math.max(theme.spacing.unit * 1.5, 0.38);
  if (mode === "stacked") {
    const copyHeight = (content.h - gap) * 0.48;
    return { copy: { ...content, h: copyHeight }, assets: { x: content.x, y: content.y + copyHeight + gap, w: content.w, h: content.h - copyHeight - gap } };
  }
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
    return { ...slot, asset: { ...asset, alt: slot.alt ?? asset.alt, long_description: slot.long_description ?? asset.long_description, decorative: slot.decorative ?? asset.decorative }, path: resolveProjectPath(project.root, asset.file) };
  });
}

function renderAssets(slide, assets, bounds, fontFace) {
  const gap = 0.22;
  const itemHeight = (bounds.h - gap * (assets.length - 1)) / assets.length;
  assets.forEach(({ asset, path: imagePath, fit, evidence_purpose, region_mappings }, index) => {
    const geometry = { x: bounds.x, y: bounds.y + index * (itemHeight + gap), w: bounds.w, h: itemHeight };
    assertGeometry(geometry);
    if (asset.screenshot_evidence) {
      const semantics = asset.screenshot_evidence;
      const annotated = (semantics.presentation_treatments ?? []).some((value) => ["callout", "annotation"].includes(value));
      const caption = semantics.annotation_text ?? evidence_purpose ?? semantics.evidence_purpose;
      if (annotated && (typeof caption !== "string" || !caption.trim() || caption.length > 80)) throw new Error(`screenshot ${asset.id} needs annotation_text of 1–80 characters`);
      if (annotated && geometry.h < 1.3) throw new Error(`insufficient space for annotated screenshot ${asset.id}`);
      const imageBounds = { ...geometry, h: geometry.h - (annotated ? 0.9 : 0) };
      const { image, placement } = screenshotPlacement(asset.image_dimensions.width, asset.image_dimensions.height, imageBounds, fit);
      slide.addImage({ path: imagePath, ...image, altText: accessibleAssetDescription(asset), objectName: `Asset ${asset.id}` });
      if (annotated) {
        const region = visibleScreenshotRegion(semantics.focal_region, placement);
        if (!(region.width > 0 && region.height > 0)) throw new Error(`screenshot ${asset.id} focal region is cropped out; use contain or revise the focal region`);
        addShape(slide, "rect", { x: region.x, y: region.y, w: region.width, h: region.height,
          fill: { color: "FFFFFF", transparency: 100 }, line: { color: "D14343", width: 2 }, objectName: `Decorative Screenshot focus ${asset.id}` });
        addText(slide, caption, { x: geometry.x, y: geometry.y + imageBounds.h + 0.1, w: geometry.w, h: 0.8,
          fontFace, fontSize: 12, color: "222222", fill: { color: "FFFFFF" }, margin: 0.05, valign: "mid", objectName: `Screenshot caption ${asset.id}` });
      }
      return;
    }
    const { image } = screenshotPlacement(asset.image_dimensions.width, asset.image_dimensions.height, geometry, fit);
    slide.addImage({
      path: imagePath, ...image,
      altText: accessibleAssetDescription(asset),
      objectName: `Asset ${asset.id}`
    });
    const semantic = compileImageSemanticLayout(asset, { region_mappings }, geometry);
    for (const { id, from, to } of semantic.connections) addShape(slide, "line", {
      x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y),
      flipH: (to.x < from.x) !== (to.y < from.y), line: { color: "D14343", width: 1.5 }, objectName: `Semantic connector ${id}`
    });
    for (const annotation of semantic.annotations) addText(slide, annotation.text, {
      ...annotation.geometry, fontFace, fontSize: 11, color: "222222", fill: { color: "FFFFFF", transparency: 5 },
      line: { color: "D14343", width: 1 }, margin: 0.05, valign: "mid", align: "center", objectName: `Semantic label ${annotation.id}`
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

function accessibleAssetDescription(asset) { return asset.decorative ? "" : [...new Set([asset.alt, asset.long_description].filter(value => typeof value === "string" && value.trim()))].join(" — ") || asset.id; }
