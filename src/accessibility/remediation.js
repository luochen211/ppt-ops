import { auditAccessibility } from "./index.js";

export async function proposeAccessibilityRemediation(service, input) {
  await service.refresh();
  const audit = auditAccessibility(service.project);
  if (audit.status === "not_requested") throw failure("ACCESSIBILITY_NOT_REQUESTED", "declare an accessibility profile before proposing remediation");
  if (input.source_revision !== audit.source_revision) throw failure("ACCESSIBILITY_AUDIT_STALE", "re-audit the current source before proposing a correction");
  const page = service.project.contracts.pages.find(page => page.id === input.page_id);
  if (!page) throw failure("ACCESSIBILITY_PAGE_INVALID", "select an existing page");
  if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw failure("ACCESSIBILITY_PATCH_INVALID", "supply a page-scoped patch");
  const allowed = new Set(["accessibility", "screen_text", "three_second_message", "asset_slots", "theme_override", "diagram", "visual_job"]);
  if (Object.keys(input.patch).some(key => !allowed.has(key))) throw failure("ACCESSIBILITY_PATCH_INVALID", "remediation may only change this page's content, semantics or design");
  if (typeof input.reason !== "string" || !input.reason.trim()) throw failure("ACCESSIBILITY_REASON_REQUIRED", "describe how the proposed change addresses the finding");
  const current = service.ensureTracked(page);
  const candidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: page.id, patch: input.patch, baseRevision: current.revision, hypothesis: input.reason });
  return { candidate, diff: service.diffCandidate(candidate.id), source_revision: audit.source_revision, applied: false, next_step: "Render the Candidate, record the exact PowerPoint observation, then obtain explicit user acceptance." };
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }
