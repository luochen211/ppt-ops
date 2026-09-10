/** Map a normalized source region through an OOXML crop into its visible box. */
export function visibleScreenshotRegion(region, placement) {
  const crop = placement.crop ?? {};
  const left = crop.left ?? 0, top = crop.top ?? 0;
  const sourceWidth = 1 - left - (crop.right ?? 0), sourceHeight = 1 - top - (crop.bottom ?? 0);
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error("invalid screenshot crop");
  const x1 = Math.max(0, Math.min(1, (region.x - left) / sourceWidth));
  const y1 = Math.max(0, Math.min(1, (region.y - top) / sourceHeight));
  const x2 = Math.max(0, Math.min(1, (region.x + region.width - left) / sourceWidth));
  const y2 = Math.max(0, Math.min(1, (region.y + region.height - top) / sourceHeight));
  return { x: (placement.x ?? 0) + x1 * placement.width, y: (placement.y ?? 0) + y1 * placement.height,
    width: (x2 - x1) * placement.width, height: (y2 - y1) * placement.height };
}

export function screenshotPlacement(width, height, bounds, fit = "contain") {
  if (!(width > 0 && height > 0 && bounds.w > 0 && bounds.h > 0)) throw new Error("screenshot dimensions must be positive");
  const scale = (fit === "cover" ? Math.max : Math.min)(bounds.w / width, bounds.h / height);
  const w = width * scale, h = height * scale;
  if (fit !== "cover") {
    const image = { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
    return { image, placement: { x: image.x, y: image.y, width: w, height: h } };
  }
  const left = (w - bounds.w) / 2, top = (h - bounds.h) / 2;
  return {
    image: { x: bounds.x, y: bounds.y, w, h, sizing: { type: "crop", x: left, y: top, w: bounds.w, h: bounds.h } },
    placement: { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, crop: { left: left / w, right: left / w, top: top / h, bottom: top / h } }
  };
}
