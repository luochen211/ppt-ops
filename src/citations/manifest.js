import crypto from "node:crypto";
import { factLedgerRevision } from "../facts/ledger.js";

const CHANNELS = ["on_slide", "speaker_notes", "appendix", "internal_only"];
const DISCLOSURES = ["public", "organization_internal", "restricted", "undisclosed"];

export function buildCitationManifest({ ledger, sources = [], pages = [], decision, metadata = {} }) {
  if (!ledger) throw failure("CITATION_LEDGER_REQUIRED", "citation rendering requires a fact ledger pinned to the Frozen Version");
  decision = normalizeDecision(decision);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const pageIds = new Set(pages.map((page) => page.id));
  const grouped = new Map();

  for (const claim of ledger.claims ?? []) for (const reference of claim.sources ?? []) {
    const publicMetadata = metadata[reference.source_id] ?? {};
    const disclosure = publicMetadata.disclosure ?? "undisclosed";
    if (!DISCLOSURES.includes(disclosure)) throw failure("CITATION_DISCLOSURE_INVALID", `invalid disclosure for ${reference.source_id}`);
    const channels = disclosure === "public" ? decision.channels.filter((channel) => channel !== "internal_only") : ["internal_only"];
    const bindings = (claim.bindings ?? []).filter(({ page_id }) => !pageIds.size || pageIds.has(page_id));
    const key = JSON.stringify([reference.source_id, reference.source_sha256, reference.locator, publicMetadata, channels]);
    const value = grouped.get(key) ?? { reference, publicMetadata, disclosure, channels, bindings: [], claims: [], source: sourceById.get(reference.source_id) };
    value.bindings.push(...bindings);
    value.claims.push({ claim_id: claim.id, claim_revision: claim.revision });
    grouped.set(key, value);
  }

  const citations = [...grouped.values()].sort(orderEntries).map(makeCitation);
  const manifest = {
    schema_version: "1.0", kind: "citation_manifest", intent: "rendering_input",
    fact_ledger_revision: factLedgerRevision(ledger), decision, citations,
    pages: pageMap(citations),
    unresolved: citations.filter(({ status }) => status === "pending").map(({ id, missing_fields }) => ({ citation_id: id, missing_fields }))
  };
  return Object.freeze({ ...manifest, revision: digest(manifest) });
}

export function applyCitationManifest(project, manifest = project.citationManifest) {
  if (!manifest) return project;
  const byId = new Map(manifest.citations.map((entry) => [entry.id, entry]));
  const pages = project.pages.map((page, index) => {
    const delivery = manifest.pages[page.id] ?? { on_slide: [], speaker_notes: [] };
    if (delivery.on_slide.length && (index === 0 || index === project.pages.length - 1)) throw failure("CITATION_BOUNDARY_CONFLICT", `page ${page.id} is a title-only boundary; use speaker notes or appendix citations`);
    if (delivery.on_slide.length > manifest.decision.max_on_slide) throw failure("CITATION_REGION_OVERFLOW", `page ${page.id} exceeds citation capacity ${manifest.decision.max_on_slide}`);
    const notes = delivery.speaker_notes.map((id) => byId.get(id)).filter(Boolean);
    const sourceNotes = notes.length ? `Sources:\n${notes.map((entry) => renderCitation(entry)).join("\n")}` : "";
    return {
      ...page,
      citation_entries: delivery.on_slide.map((id) => byId.get(id)).filter(Boolean),
      ...(sourceNotes ? { speaker_notes: [page.speaker_notes, sourceNotes].filter(Boolean).join("\n\n") } : {})
    };
  });
  const appendix = manifest.decision.channels.includes("appendix") ? appendixPages(manifest, pages.length) : [];
  return { ...project, pages: [...pages, ...appendix], citationManifest: manifest };
}

export function citationReviewEvidence(manifest) {
  if (!manifest) return undefined;
  const hyperlink_inspection = manifest.citations
    .filter(({ url }) => url && !/^https?:\/\//i.test(url))
    .map(({ id }) => ({ citation_id: id, status: "unresolved", reason: "unsupported hyperlink scheme" }));
  return Object.freeze({
    schema_version: "1.0", kind: "citation_review", intent: "read_only", mutation_performed: false,
    citation_manifest_revision: manifest.revision, fact_ledger_revision: manifest.fact_ledger_revision,
    status: manifest.unresolved.length || hyperlink_inspection.length ? "needs_review" : "passed",
    coverage: { citation_count: manifest.citations.length, page_count: Object.keys(manifest.pages).length, unresolved_metadata: manifest.unresolved.length },
    disclosure: manifest.decision, unresolved_metadata: manifest.unresolved, hyperlink_inspection,
    fact_validity_is_separate: true
  });
}

function makeCitation(entry, index) {
  const number = index + 1;
  const visible = entry.disclosure === "public";
  const fields = visible ? entry.publicMetadata : {};
  const missing_fields = visible ? ["public_label", "title"].filter((field) => !text(fields[field])) : [];
  return Object.freeze({
    id: `cite-${String(number).padStart(3, "0")}`, number,
    source_id: entry.reference.source_id, source_sha256: entry.reference.source_sha256,
    extraction_revision: entry.reference.extraction_revision ?? null,
    locator: visible ? entry.reference.locator : null,
    claim_revisions: unique(entry.claims),
    claim_ids: [...new Set(entry.claims.map(({ claim_id }) => claim_id))].sort(),
    bindings: unique(entry.bindings).sort((a, b) => a.page_id.localeCompare(b.page_id) || a.field.localeCompare(b.field)),
    disclosure: entry.disclosure, channels: entry.channels,
    public_label: fields.public_label ?? null, author_or_organization: fields.author_or_organization ?? null,
    title: fields.title ?? null, date: fields.date ?? null, url: fields.url ?? null,
    status: !visible ? "internal_only" : missing_fields.length ? "pending" : "ready", missing_fields,
    source_present: Boolean(entry.source), source_hash_matches: entry.source?.sha256 === entry.reference.source_sha256
  });
}

function appendixPages(manifest, originalCount) {
  const entries = manifest.citations.filter(({ channels }) => channels.includes("appendix"));
  const pages = [];
  for (let offset = 0; offset < entries.length; offset += 8) {
    const chunk = entries.slice(offset, offset + 8);
    pages.push({
      id: `citation-appendix-${String(pages.length + 1).padStart(3, "0")}`,
      page: originalCount + pages.length + 1, task: "Provide creator-approved source references",
      three_second_message: "Sources", relation: "sequence",
      screen_text: { title: pages.length ? "Sources (continued)" : "Sources", body: chunk.map(renderCitation) },
      visual_job: "Editable source appendix", asset_slots: [], status: "built", content_status: "accepted",
      renderers: { html: "default", pptx: "default" }, html: "default", pptx: "default"
    });
  }
  return pages;
}

function renderCitation(entry) {
  const label = [entry.author_or_organization, entry.title, entry.date].filter(Boolean).join(". ") || entry.public_label || "Citation metadata pending";
  return `[${entry.number}] ${label}${entry.url ? ` — ${entry.url}` : ""}`;
}
function normalizeDecision(value) {
  if (!value || !Array.isArray(value.channels) || !value.channels.length) throw failure("CITATION_DECISION_REQUIRED", "select citation channels before rendering");
  const channels = [...new Set(value.channels)];
  if (channels.some((channel) => !CHANNELS.includes(channel))) throw failure("CITATION_CHANNEL_INVALID", "unsupported citation channel");
  const max_on_slide = value.max_on_slide ?? 3;
  if (!Number.isInteger(max_on_slide) || max_on_slide < 1) throw failure("CITATION_CAPACITY_INVALID", "max_on_slide must be positive");
  if (!text(value.actor) || !text(value.decided_at)) throw failure("CITATION_DECISION_INVALID", "decision actor and time are required");
  return Object.freeze({ channels, max_on_slide, actor: value.actor, decided_at: value.decided_at });
}
function pageMap(citations) {
  const pages = {};
  for (const citation of citations) for (const binding of citation.bindings) {
    const channels = pages[binding.page_id] ?? { on_slide: [], speaker_notes: [], appendix: [] };
    for (const channel of citation.channels) if (channels[channel]) channels[channel].push(citation.id);
    pages[binding.page_id] = channels;
  }
  return Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b)));
}
function orderEntries(a, b) { return firstPage(a).localeCompare(firstPage(b)) || a.reference.source_id.localeCompare(b.reference.source_id) || a.reference.locator.localeCompare(b.reference.locator); }
function firstPage(entry) { return entry.bindings.map(({ page_id }) => page_id).sort()[0] ?? "~"; }
function unique(values) { return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]; }
function digest(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function text(value) { return typeof value === "string" && value.trim() !== ""; }
function failure(code, message) { return Object.assign(new Error(message), { code }); }
