import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { aspectRatioValue } from "./prompt.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectRaster(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return inspectPng(buffer);
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return inspectJpeg(buffer);
  return { supported: false, mime: null, extension: null, width: null, height: null, has_alpha: null, signature: "unknown" };
}

export async function inspectRaster(projectRoot, candidateFile, requirements = {}) {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(candidateFile);
  const relative = path.relative(root, resolved);
  const contained = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!contained) {
    const error = new Error(`visual asset escapes project root: ${candidateFile}`);
    error.code = "VISUAL_ASSET_PATH_OUTSIDE_ROOT";
    throw error;
  }
  const bytes = await fs.readFile(resolved);
  const detected = detectRaster(bytes);
  const actualRatio = detected.width && detected.height ? detected.width / detected.height : null;
  const expectedRatio = requirements.aspect_ratio ? aspectRatioValue(requirements.aspect_ratio) : null;
  const tolerance = requirements.ratio_tolerance ?? 0.03;
  const ratioMatches = expectedRatio === null || (actualRatio !== null && Math.abs(actualRatio - expectedRatio) / expectedRatio <= tolerance);
  const mimeMatches = requirements.mime ? detected.mime === requirements.mime : detected.supported;
  const alphaMatches = requirements.transparency_required !== true || (detected.mime === "image/png" && detected.has_alpha === true);
  const checks = {
    contained: true,
    supported_signature: detected.supported,
    mime_matches: mimeMatches,
    dimensions_present: Boolean(detected.width && detected.height),
    aspect_ratio_matches: ratioMatches,
    alpha_channel_matches: alphaMatches
  };
  return Object.freeze({
    passed: Object.values(checks).every(Boolean),
    file: relative.split(path.sep).join("/"),
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    mime: detected.mime,
    extension: detected.extension,
    signature: detected.signature,
    width: detected.width,
    height: detected.height,
    aspect_ratio: actualRatio === null ? null : Number(actualRatio.toFixed(6)),
    has_alpha: detected.has_alpha,
    checks: Object.freeze(checks),
    visual_claims: Object.freeze({
      semantic_action: "pending_visual_observation",
      subject_count: "pending_visual_observation",
      identity_boundary: "pending_visual_observation",
      visible_text_or_logo: "pending_visual_observation",
      reference_invariants: "pending_visual_observation",
      edge_integration: "pending_visual_observation",
      copy_safe_space: "pending_visual_observation"
    })
  });
}

function inspectPng(bytes) {
  if (bytes.length < 33 || bytes.toString("ascii", 12, 16) !== "IHDR") return unsupported("png-invalid");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  const hasTrns = bytes.includes(Buffer.from("tRNS", "ascii"));
  return { supported: width > 0 && height > 0, mime: "image/png", extension: ".png", width, height, has_alpha: [4, 6].includes(colorType) || hasTrns, signature: "png" };
}

function inspectJpeg(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return { supported: width > 0 && height > 0, mime: "image/jpeg", extension: ".jpg", width, height, has_alpha: false, signature: "jpeg" };
    }
    offset += 2 + length;
  }
  return unsupported("jpeg-invalid", "image/jpeg", ".jpg", false);
}

function unsupported(signature, mime = null, extension = null, hasAlpha = null) {
  return { supported: false, mime, extension, width: null, height: null, has_alpha: hasAlpha, signature };
}
