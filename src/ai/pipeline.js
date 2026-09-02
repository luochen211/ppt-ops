import crypto from "node:crypto";
import { createV1Entity, validateV1Entity } from "../contracts/v1.js";
import { transition } from "../core/state-machines.js";

export const AI_TASKS = Object.freeze({
  material_summary: { targetKind: "source", allowedPaths: ["/summary"] },
  outline: { targetKind: "outline", allowedPaths: ["/sections"] },
  page_spec: { targetKind: "page_spec", allowedPaths: ["/task", "/three_second_message", "/screen_text", "/visual_job", "/relation", "/template_id"] },
  copy_compression: { targetKind: "page_spec", allowedPaths: ["/screen_text"] },
  relation_recommendation: { targetKind: "page_spec", allowedPaths: ["/relation"] },
  template_recommendation: { targetKind: "page_spec", allowedPaths: ["/template_id"] }
});

export class CandidatePipeline {
  constructor({ provider, store, projectId, maxAttempts = 2, audit = () => {} }) {
    if (!provider?.generate) throw new Error("provider.generate is required");
    this.provider = provider; this.store = store; this.projectId = projectId; this.maxAttempts = maxAttempts; this.audit = audit;
  }

  async generate({ task, target, instruction = "", sourceSegments = [], privacy = {} }) {
    const policy = AI_TASKS[task];
    if (!policy) throw new Error(`unknown AI task: ${task}`);
    if (target.kind !== policy.targetKind) throw new Error(`${task} requires target kind ${policy.targetKind}`);
    const payload = buildPayload({ task, target, instruction, sourceSegments, privacy, allowedPaths: policy.allowedPaths });
    const auditRecord = auditPayload(payload, privacy);
    this.audit({ type: "ai.request.prepared", ...auditRecord });
    const response = await requestWithRetry(this.provider, payload, this.maxAttempts, (event) => this.audit(event));
    const structured = parseStructuredResponse(response);
    validatePatch(structured.patch, policy.allowedPaths);
    if (structured.target_id !== target.id) throw new Error(`AI response targeted ${structured.target_id}; expected ${target.id}`);
    let candidate = createV1Entity("candidate", candidateId(task, target, structured.patch), {
      task, target_id: target.id, target_kind: target.kind, state: "generated", patch: structured.patch,
      source_refs: structured.source_refs ?? [], rationale: structured.rationale ?? "",
      base_hash: sha256(stableJson(target)), provider: this.provider.id ?? "provider",
      request_audit: auditRecord
    });
    candidate = transition("candidate", candidate, "validating");
    const errors = validateV1Entity(candidate, "candidate");
    if (errors.length) throw new Error(`candidate contract failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    candidate = transition("candidate", candidate, "ready_for_review");
    this.audit({ type: "ai.candidate.ready", candidate_id: candidate.id, patch_paths: candidate.patch.map(({ path }) => path) });
    return this.store ? this.store.saveEntity(this.projectId, candidate) : candidate;
  }

  recordRenderEvidence(candidateId, renderEvidence) {
    if (!this.store) throw new Error("candidate rendering requires a persistence store");
    const candidate = this.store.getEntity(this.projectId, "candidate", candidateId);
    if (!candidate) throw new Error(`unknown candidate: ${candidateId}`);
    if (candidate.state !== "ready_for_review") throw new Error(`invalid candidate render state: ${candidate.state}`);
    if (!renderEvidence?.artifact || !renderEvidence?.sha256 || !Array.isArray(renderEvidence.pages)) throw new Error("candidate render evidence requires artifact, sha256, and pages");
    const next = transition("candidate", { ...candidate, render_evidence: structuredClone(renderEvidence) }, "awaiting_powerpoint_observation");
    return this.store.saveEntity(this.projectId, stripRevision(next));
  }

  observeInPowerPoint(candidateId, evidence = {}) {
    if (!this.store) throw new Error("candidate decisions require a persistence store");
    const candidate = this.store.getEntity(this.projectId, "candidate", candidateId);
    if (!candidate) throw new Error(`unknown candidate: ${candidateId}`);
    if (candidate.state !== "awaiting_powerpoint_observation") throw new Error(`invalid PowerPoint observation state: ${candidate.state}`);
    if (evidence.application !== "Microsoft PowerPoint" || evidence.artifact !== candidate.render_evidence?.artifact || evidence.sha256 !== candidate.render_evidence?.sha256 || JSON.stringify(evidence.pages) !== JSON.stringify(candidate.render_evidence?.pages)) throw new Error("PowerPoint observation must match Candidate render evidence");
    const observation = this.store.saveEntity(this.projectId, createV1Entity("powerpoint_observation", `powerpoint-${crypto.randomUUID()}`, {
      candidate_id: candidate.id, target_id: candidate.target_id, status: "viewed", evidence
    }));
    const next = transition("candidate", candidate, "awaiting_user_decision");
    return { observation, candidate: this.store.saveEntity(this.projectId, stripRevision(next)) };
  }

  decide(candidateId, { decision, rawFeedback, evalCategory, rootCause, rootCauseFingerprint }) {
    if (!this.store) throw new Error("candidate decisions require a persistence store");
    const candidate = this.store.getEntity(this.projectId, "candidate", candidateId);
    if (!candidate) throw new Error(`unknown candidate: ${candidateId}`);
    if (candidate.state !== "awaiting_user_decision") throw new Error(`invalid candidate decision state: ${candidate.state}`);
    if (!["accept", "continue_iteration", "reject"].includes(decision)) throw new Error(`invalid candidate decision: ${decision}`);
    if (typeof rawFeedback !== "string" || rawFeedback.trim() === "") throw new Error("raw user feedback is required");
    const cause = rootCause ?? "process"; const category = evalCategory ?? "user_acceptance"; const fingerprint = rootCauseFingerprint ?? cause;
    const previous = this.store.listEntities(this.projectId, "candidate_feedback").filter((item) => item.target_id === candidate.target_id && item.decision === "reject" && item.actor === "user" && item.root_cause_fingerprint === fingerprint).length;
    const forceReconstruction = decision === "reject" && previous >= 1;
    this.store.saveEntity(this.projectId, createV1Entity("candidate_feedback", `feedback-${crypto.randomUUID()}`, {
      candidate_id: candidate.id, target_id: candidate.target_id, decision, actor: "user", eval_category: category, root_cause: cause,
      root_cause_fingerprint: fingerprint, raw_feedback: rawFeedback, force_reconstruction: forceReconstruction
    }));
    const state = decision === "accept" ? "accepted" : decision === "continue_iteration" ? "continued" : forceReconstruction ? "reconstruction_required" : "rejected";
    const next = transition("candidate", candidate, state);
    return this.store.saveEntity(this.projectId, stripRevision(next));
  }

  apply(candidateId, draft) {
    if (!this.store) throw new Error("candidate application requires a persistence store");
    const candidate = this.store.getEntity(this.projectId, "candidate", candidateId);
    if (!candidate || candidate.state !== "accepted") throw new Error("only accepted candidates may be applied");
    if (candidate.target_id !== draft.id) throw new Error("candidate target does not match the draft");
    if (candidate.base_hash !== sha256(stableJson(draft))) throw new Error("draft changed after candidate generation");
    const updated = applyPatch(draft, candidate.patch);
    const applied = transition("candidate", candidate, "applied_to_draft");
    this.store.saveEntity(this.projectId, stripRevision(applied));
    return updated;
  }
}

export function buildPayload({ task, target, instruction, sourceSegments, privacy, allowedPaths }) {
  const sources = sourceSegments.map((segment) => ({
    source_id: segment.source_id, locator: segment.locator,
    ...(privacy.allowSourceText === true ? { text: segment.text } : { text_sha256: sha256(segment.text ?? "") })
  }));
  return {
    contract_version: "1.0", task, instruction: String(instruction).slice(0, 4000),
    target: { id: target.id, kind: target.kind, snapshot: pickTargetSnapshot(target, allowedPaths) },
    sources, output: { type: "json", allowed_patch_paths: allowedPaths }
  };
}

export function applyPatch(document, patch) {
  const result = structuredClone(document);
  for (const operation of patch) {
    const parts = operation.path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    let parent = result;
    for (const part of parts.slice(0, -1)) {
      if (!parent[part] || typeof parent[part] !== "object") parent[part] = {};
      parent = parent[part];
    }
    if (operation.op === "remove") delete parent[parts.at(-1)]; else parent[parts.at(-1)] = structuredClone(operation.value);
  }
  return result;
}

function validatePatch(patch, allowedPaths) {
  if (!Array.isArray(patch) || patch.length === 0) throw new Error("AI response patch must be a non-empty array");
  for (const [index, operation] of patch.entries()) {
    if (!operation || !["add", "replace", "remove"].includes(operation.op)) throw new Error(`patch[${index}].op is invalid`);
    if (!allowedPaths.some((path) => operation.path === path || operation.path.startsWith(`${path}/`))) throw new Error(`patch path is not allowed for this task: ${operation.path}`);
    if (operation.path.split("/").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error(`unsafe patch path is forbidden: ${operation.path}`);
    if (operation.path === "/id" || operation.path === "/kind" || operation.path === "/contract_version") throw new Error(`identity patch is forbidden: ${operation.path}`);
    if (operation.op !== "remove" && !("value" in operation)) throw new Error(`patch[${index}].value is required`);
  }
}

async function requestWithRetry(provider, payload, maxAttempts, audit) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await provider.generate(payload); }
    catch (error) {
      lastError = error; audit({ type: "ai.request.failed", attempt, retryable: error.retryable === true, code: error.code ?? "PROVIDER_FAILED" });
      if (error.retryable !== true || attempt === maxAttempts) break;
    }
  }
  throw lastError;
}
function parseStructuredResponse(response) {
  const value = typeof response === "string" ? JSON.parse(response) : response;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provider response must be a JSON object");
  return value;
}
function pickTargetSnapshot(target, allowedPaths) {
  return Object.fromEntries([...new Set(allowedPaths.map((pointer) => pointer.split("/")[1]))].filter((key) => key in target).map((key) => [key, target[key]]));
}
function auditPayload(payload, privacy) {
  return { policy: { allow_source_text: privacy.allowSourceText === true }, payload_sha256: sha256(stableJson(payload)), field_paths: collectPaths(payload), source_count: payload.sources.length };
}
function collectPaths(value, prefix = "") {
  if (!value || typeof value !== "object") return [prefix || "/"];
  return Object.entries(value).flatMap(([key, child]) => collectPaths(child, `${prefix}/${key}`)).sort();
}
function candidateId(task, target, patch) { return `candidate-${sha256(`${task}:${target.id}:${stableJson(patch)}`).slice(0, 16)}`; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function stripRevision({ revision, ...entity }) { return entity; }
