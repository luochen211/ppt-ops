import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../core/project.js";
import { requireUser } from "./outline.js";

export const DELIVERY_FORMATS = Object.freeze({ presentation: ["html", "pptx", "pdf"], outline: ["markdown", "docx", "pdf"] });

export class DeliverySelectionError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

export function deliveryCapabilities({ artifactType, availableFormats = [] }) {
  const allowed = requireArtifactType(artifactType);
  const available = new Set(availableFormats);
  return allowed.map((format) => ({
    format,
    status: available.has(format) ? "available" : "unavailable",
    ...(available.has(format) ? {} : { reason: `No ${format} exporter or eligible reviewed artifact is available.` })
  }));
}

export async function recordDeliverySelection(projectRoot, input, options = {}) {
  const allowed = requireArtifactType(input.artifact_type);
  requireUser(input.actor);
  if (!Array.isArray(input.formats) || input.formats.length === 0) throw new DeliverySelectionError("DELIVERY_FORMAT_REQUIRED", "the user must explicitly select at least one delivery format");
  const formats = [...new Set(input.formats.map((value) => String(value).trim().toLowerCase()))];
  const invalid = formats.filter((format) => !allowed.includes(format));
  if (invalid.length) throw new DeliverySelectionError("DELIVERY_FORMAT_INVALID", `unsupported ${input.artifact_type} format: ${invalid.join(", ")}`, { allowed });
  for (const field of ["source_id", "source_revision", "actor"]) if (!hasText(input[field])) throw new DeliverySelectionError("DELIVERY_EVIDENCE_REQUIRED", `delivery selection requires ${field}`);
  const capabilities = deliveryCapabilities({ artifactType: input.artifact_type, availableFormats: input.available_formats ?? [] });
  const unavailable = capabilities.filter(({ format, status }) => formats.includes(format) && status !== "available");
  if (unavailable.length) throw new DeliverySelectionError("EXPORTER_UNAVAILABLE", "one or more requested formats are unavailable; accepted work was not changed", { unavailable, capabilities });
  const decidedAt = options.now?.() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(decidedAt)) || (input.selection_source !== undefined && !hasText(input.selection_source))) throw new DeliverySelectionError("DELIVERY_EVIDENCE_REQUIRED", "decision time and source must be valid");
  const id = input.id ?? `delivery-selection-${decidedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${crypto.randomUUID().slice(0, 8)}`;
  validateId(id);
  const decision = {
    schema_version: "1.0", kind: "delivery_selection", id,
    artifact_type: input.artifact_type, formats, source_id: input.source_id,
    source_revision: input.source_revision, actor: input.actor, decided_at: decidedAt,
    selection_source: input.selection_source ?? "user_conversation",
    ...(input.approval_id ? { approval_id: input.approval_id } : {}),
    ...(input.pdf_source ? { pdf_source: input.pdf_source } : {})
  };
  const relative = path.join(".pptops", "delivery-selections", id, "manifest.json");
  const file = resolveProjectPath(projectRoot, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(decision, null, 2)}\n`, { flag: "wx" });
  return { decision, manifest_file: file };
}

export async function readDeliverySelection(projectRoot, id) {
  validateId(id);
  const file = resolveProjectPath(projectRoot, path.join(".pptops", "delivery-selections", id, "manifest.json"));
  let decision;
  try { decision = JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new DeliverySelectionError("DELIVERY_SELECTION_NOT_FOUND", `unknown delivery selection: ${id}`);
    throw error;
  }
  if (decision?.kind !== "delivery_selection" || decision.id !== id) throw new DeliverySelectionError("DELIVERY_SELECTION_INVALID", `invalid delivery selection evidence: ${id}`);
  requireUser(decision.actor);
  const allowed = requireArtifactType(decision.artifact_type);
  if (!Array.isArray(decision.formats) || !decision.formats.length || new Set(decision.formats).size !== decision.formats.length || decision.formats.some(format => !allowed.includes(format)) || !hasText(decision.source_id) || !hasText(decision.source_revision) || !hasText(decision.selection_source) || !Number.isFinite(Date.parse(decision.decided_at))) throw new DeliverySelectionError("DELIVERY_SELECTION_INVALID", "stored decision is incomplete or invalid");
  return decision;
}

function requireArtifactType(value) {
  const formats = DELIVERY_FORMATS[value];
  if (!formats) throw new DeliverySelectionError("DELIVERY_ARTIFACT_INVALID", "artifact_type must be presentation or outline");
  return formats;
}
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }

function validateId(id) { if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new DeliverySelectionError("DELIVERY_SELECTION_INVALID", "delivery selection id is invalid"); }
