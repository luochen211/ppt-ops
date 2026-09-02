import { EVAL_CATEGORIES, FINDING_SEVERITIES, ROOT_CAUSES } from "../contracts/v1.js";

const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export class FeedbackValidationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function normalizeFeedbackFindings(findings, { targetKind, targetId, decision, actor }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new FeedbackValidationError("FINDINGS_REQUIRED", "candidate feedback requires at least one atomic finding");
  }
  const normalized = findings.map((finding, index) => normalizeFinding(finding, index, { targetKind, targetId, decision, actor }));
  const hasAcceptance = normalized.some(({ eval_category: category }) => category === "user_acceptance");
  if (decision === "accept" && !hasAcceptance) {
    throw new FeedbackValidationError("USER_ACCEPTANCE_FINDING_REQUIRED", "acceptance requires a user_acceptance finding");
  }
  if (decision !== "accept" && hasAcceptance) {
    throw new FeedbackValidationError("USER_ACCEPTANCE_FINDING_INVALID", "user_acceptance findings are only valid for acceptance decisions");
  }
  return normalized;
}

export function repeatedRootCauseFingerprints(feedback, targetId, findings) {
  const previous = new Set(
    feedback
      .filter((item) => item.target_id === targetId && item.decision === "reject" && item.actor === "user")
      .flatMap((item) => item.findings ?? [])
      .map((finding) => finding.root_cause_fingerprint)
  );
  return [...new Set(findings.map((finding) => finding.root_cause_fingerprint).filter((fingerprint) => previous.has(fingerprint)))];
}

function normalizeFinding(finding, index, { targetKind, targetId, decision, actor }) {
  if (!isPlainObject(finding)) throw invalid("FINDING_INVALID", index, "must be an object");
  const category = finding.eval_category;
  if (!EVAL_CATEGORIES.includes(category)) throw invalid("EVAL_CATEGORY_INVALID", index, `has invalid eval_category: ${category}`);
  if (actor === "automated_qa" && category === "user_acceptance") throw invalid("EVAL_CATEGORY_INVALID", index, "automated QA cannot record user_acceptance");
  const rootCause = finding.root_cause;
  if (!ROOT_CAUSES.includes(rootCause)) throw invalid("ROOT_CAUSE_INVALID", index, `has invalid root_cause: ${rootCause}`);
  const correctedRootCause = finding.corrected_root_cause;
  if (correctedRootCause !== undefined && !ROOT_CAUSES.includes(correctedRootCause)) {
    throw invalid("ROOT_CAUSE_INVALID", index, `has invalid corrected_root_cause: ${correctedRootCause}`);
  }
  const confidence = finding.classification_confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw invalid("CONFIDENCE_INVALID", index, "classification_confidence must be between 0 and 1");
  }
  const severity = finding.severity ?? (decision === "accept" ? "note" : "major");
  if (!FINDING_SEVERITIES.includes(severity)) throw invalid("FINDING_SEVERITY_INVALID", index, `has invalid severity: ${severity}`);
  const target = finding.target ?? { kind: targetKind, id: targetId };
  if (!isPlainObject(target) || !hasText(target.kind) || !STABLE_ID_PATTERN.test(target.id ?? "")) {
    throw invalid("FINDING_TARGET_INVALID", index, "target requires a kind and stable lowercase id");
  }
  const evidence = finding.evidence ?? {};
  if (!isPlainObject(evidence)) throw invalid("FINDING_EVIDENCE_INVALID", index, "evidence must be an object");
  const effectiveCause = correctedRootCause ?? rootCause;
  const fingerprint = hasText(finding.root_cause_fingerprint) ? finding.root_cause_fingerprint.trim() : effectiveCause;
  return {
    eval_category: category,
    root_cause: rootCause,
    root_cause_fingerprint: fingerprint,
    severity,
    target: structuredClone(target),
    evidence: structuredClone(evidence),
    ...(confidence !== undefined ? { classification_confidence: confidence } : {}),
    ...(correctedRootCause ? { corrected_root_cause: correctedRootCause } : {})
  };
}

function invalid(code, index, message) {
  return new FeedbackValidationError(code, `findings[${index}] ${message}`, { finding_index: index });
}
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
