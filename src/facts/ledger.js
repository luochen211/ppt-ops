import crypto from "node:crypto";

export const CLAIM_KINDS = Object.freeze(["timeless", "time_sensitive", "forecast", "quotation", "derived", "organization_assertion"]);
export const CLAIM_STATUSES = Object.freeze(["supported", "unverified", "conflicted", "superseded", "withdrawn", "unable_to_verify"]);
export const VALIDITY_MODES = Object.freeze(["timeless", "unknown", "date", "review", "event", "version"]);

const ID = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function claimStatementHash(statement) {
  return crypto.createHash("sha256").update(statement).digest("hex");
}

export function factLedgerRevision(ledger) {
  return crypto.createHash("sha256").update(stableJson(ledger)).digest("hex");
}

export function validateFactLedger(ledger, context = {}) {
  const errors = [];
  if (!isObject(ledger)) return ["fact ledger must be an object"];
  if (ledger.schema_version !== "1.0") errors.push("schema_version must be 1.0");
  if (!ID.test(ledger.project_id ?? "")) errors.push("project_id must be a stable lowercase identifier");
  else if (context.projectId && ledger.project_id !== context.projectId) errors.push(`project_id does not match project: ${ledger.project_id}`);
  if (!Array.isArray(ledger.claims)) return [...errors, "claims must be an array"];
  const ids = new Set();
  const hasSourceContext = Array.isArray(context.sources);
  const hasPageContext = Array.isArray(context.pages);
  const sources = new Map((context.sources ?? []).map((source) => [source.id, source]));
  const pages = new Map((context.pages ?? []).map((page) => [page.id, page]));

  for (const [index, claim] of ledger.claims.entries()) {
    const prefix = `claims[${index}]`;
    if (!isObject(claim)) { errors.push(`${prefix} must be an object`); continue; }
    if (!ID.test(claim.id ?? "")) errors.push(`${prefix}.id must be a stable lowercase identifier`);
    else if (ids.has(claim.id)) errors.push(`${prefix}.id is duplicated: ${claim.id}`);
    else ids.add(claim.id);
    if (!Number.isInteger(claim.revision) || claim.revision < 1) errors.push(`${prefix}.revision must be a positive integer`);
    if (!hasText(claim.statement)) errors.push(`${prefix}.statement is required`);
    if (!SHA256.test(claim.statement_sha256 ?? "")) errors.push(`${prefix}.statement_sha256 must be a SHA-256 digest`);
    else if (hasText(claim.statement) && claim.statement_sha256 !== claimStatementHash(claim.statement)) errors.push(`${prefix}.statement_sha256 does not match statement`);
    if (!CLAIM_KINDS.includes(claim.kind)) errors.push(`${prefix}.kind is invalid: ${claim.kind}`);
    if (!CLAIM_STATUSES.includes(claim.status)) errors.push(`${prefix}.status is invalid: ${claim.status}`);
    validateValidity(claim.validity, prefix, errors);
    if (!Array.isArray(claim.sources) || (claim.status === "supported" && claim.kind !== "derived" && claim.sources.length === 0)) errors.push(`${prefix}.sources must contain evidence for a supported claim`);
    for (const [sourceIndex, reference] of (claim.sources ?? []).entries()) {
      const field = `${prefix}.sources[${sourceIndex}]`;
      if (!ID.test(reference?.source_id ?? "")) errors.push(`${field}.source_id is invalid`);
      if (!hasText(reference?.locator)) errors.push(`${field}.locator is required`);
      if (!SHA256.test(reference?.source_sha256 ?? "")) errors.push(`${field}.source_sha256 must be a SHA-256 digest`);
      if (hasSourceContext && !sources.has(reference?.source_id)) errors.push(`${field} references a missing source: ${reference?.source_id}`);
    }
    if (!Array.isArray(claim.bindings) || claim.bindings.length === 0) errors.push(`${prefix}.bindings must identify at least one exact Page Spec field`);
    for (const [bindingIndex, binding] of (claim.bindings ?? []).entries()) {
      const field = `${prefix}.bindings[${bindingIndex}]`;
      const page = pages.get(binding?.page_id);
      if (!ID.test(binding?.page_id ?? "")) errors.push(`${field}.page_id is invalid`);
      else if (hasPageContext && !page) errors.push(`${field} references a missing page: ${binding.page_id}`);
      if (!hasText(binding?.field) || !binding.field.startsWith("/")) errors.push(`${field}.field must be a JSON Pointer`);
      else if (page && resolvePointer(page, binding.field) === undefined) errors.push(`${field}.field does not resolve on ${binding.page_id}: ${binding.field}`);
    }
    if (claim.kind === "derived" && (!isObject(claim.derivation) || !Array.isArray(claim.derivation.claim_ids) || claim.derivation.claim_ids.length === 0)) errors.push(`${prefix}.derivation.claim_ids is required for a derived claim`);
    if (claim.superseded_by !== undefined && !ID.test(claim.superseded_by)) errors.push(`${prefix}.superseded_by is invalid`);
  }
  for (const [index, claim] of ledger.claims.entries()) {
    if (claim?.superseded_by && !ids.has(claim.superseded_by)) errors.push(`claims[${index}].superseded_by references a missing claim: ${claim.superseded_by}`);
    for (const id of claim?.derivation?.claim_ids ?? []) if (!ids.has(id)) errors.push(`claims[${index}].derivation references a missing claim: ${id}`);
  }
  return errors;
}

export function evaluateFactLedger(ledger, context = {}) {
  const errors = validateFactLedger(ledger, context);
  const at = parseInstant(context.at, "at");
  const sources = new Map((context.sources ?? []).map((source) => [source.id, source]));
  const claims = (ledger?.claims ?? []).map((claim) => {
    const source_integrity = (claim.sources ?? []).map((reference) => {
      const source = sources.get(reference.source_id);
      return { source_id: reference.source_id, locator: reference.locator, status: !source ? "missing" : source.sha256 === reference.source_sha256 ? "current" : "changed", expected_sha256: reference.source_sha256, actual_sha256: source?.sha256 ?? null };
    });
    return { claim_id: claim.id, claim_revision: claim.revision, kind: claim.kind, assertion_status: claim.status, validity_status: validityStatus(claim, at), source_integrity, bindings: structuredClone(claim.bindings ?? []) };
  });
  const policy = context.policy ?? {};
  const blockingStatuses = new Set(policy.blocking_statuses ?? []);
  const requiredKinds = new Set(policy.required_kinds ?? []);
  const blockers = claims.filter((claim) => (requiredKinds.size === 0 || requiredKinds.has(claim.kind)) && (blockingStatuses.has(claim.assertion_status) || blockingStatuses.has(claim.validity_status) || claim.source_integrity.some(({ status }) => blockingStatuses.has(`source_${status}`))));
  return Object.freeze({
    schema_version: "1.0", kind: "fact_ledger_evaluation", intent: "read_only", mutation_performed: false,
    ledger_revision: factLedgerRevision(ledger), evaluated_at: at.toISOString(), valid: errors.length === 0, errors: Object.freeze(errors),
    status: errors.length ? "failed" : blockers.length ? "failed" : claims.some(needsReview) ? "needs_review" : "passed",
    policy: Object.freeze({ required_kinds: [...requiredKinds], blocking_statuses: [...blockingStatuses] }), blocker_claim_ids: Object.freeze(blockers.map(({ claim_id }) => claim_id)), claims: Object.freeze(claims), summary: summarize(claims)
  });
}

export function reportFactLedgerImpact(before, after, context = {}) {
  const beforeById = new Map((before?.claims ?? []).map((claim) => [claim.id, claim]));
  const afterById = new Map((after?.claims ?? []).map((claim) => [claim.id, claim]));
  const changed_claim_ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].filter((id) => stableJson(beforeById.get(id)) !== stableJson(afterById.get(id))).sort();
  const affected = changed_claim_ids.flatMap((id) => afterById.get(id)?.bindings ?? beforeById.get(id)?.bindings ?? []);
  const affected_page_ids = [...new Set(affected.map(({ page_id }) => page_id))].sort();
  const affected_artifacts = (context.artifacts ?? []).filter((artifact) => (artifact.claim_ids ?? []).some((id) => changed_claim_ids.includes(id))).map((artifact) => ({ id: artifact.id, kind: artifact.kind, variant_id: artifact.variant_id ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({ changed_claim_ids, affected_page_ids, affected_bindings: affected, affected_artifacts });
}

function validityStatus(claim, at) {
  const validity = claim.validity ?? {};
  if (validity.valid_until && at > parseInstant(validity.valid_until, "valid_until")) return "expired";
  if (validity.review_after && at > parseInstant(validity.review_after, "review_after")) return "review_due";
  if (validity.mode === "unknown") return "unknown";
  if (["event", "version"].includes(validity.mode)) return "conditional";
  return "current";
}

function validateValidity(validity, prefix, errors) {
  if (!isObject(validity)) { errors.push(`${prefix}.validity must be an object`); return; }
  if (!VALIDITY_MODES.includes(validity.mode)) errors.push(`${prefix}.validity.mode is invalid: ${validity.mode}`);
  for (const field of ["verified_at", "valid_until", "review_after"]) if (validity[field] !== undefined && !isInstant(validity[field])) errors.push(`${prefix}.validity.${field} must be an ISO date-time`);
  if (validity.mode === "date" && !validity.valid_until) errors.push(`${prefix}.validity.valid_until is required for date mode`);
  if (validity.mode === "review" && !validity.review_after) errors.push(`${prefix}.validity.review_after is required for review mode`);
  if (validity.mode === "event" && !hasText(validity.event)) errors.push(`${prefix}.validity.event is required for event mode`);
  if (validity.mode === "version" && !hasText(validity.version)) errors.push(`${prefix}.validity.version is required for version mode`);
}

function summarize(claims) {
  const count = (field, value) => claims.filter((claim) => claim[field] === value).length;
  return Object.freeze({ total: claims.length, current: count("validity_status", "current"), review_due: count("validity_status", "review_due"), expired: count("validity_status", "expired"), unknown: count("validity_status", "unknown"), conflicted: count("assertion_status", "conflicted"), unable_to_verify: count("assertion_status", "unable_to_verify"), changed_sources: claims.filter((claim) => claim.source_integrity.some(({ status }) => status === "changed")).length, missing_sources: claims.filter((claim) => claim.source_integrity.some(({ status }) => status === "missing")).length });
}
function needsReview(claim) { return !["supported", "superseded", "withdrawn"].includes(claim.assertion_status) || claim.validity_status !== "current" || claim.source_integrity.some(({ status }) => status !== "current"); }
function resolvePointer(value, pointer) { try { return pointer.split("/").slice(1).reduce((current, token) => current?.[token.replaceAll("~1", "/").replaceAll("~0", "~")], value); } catch { return undefined; } }
function parseInstant(value, field) { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} must be an ISO date-time`); return date; }
function isInstant(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
