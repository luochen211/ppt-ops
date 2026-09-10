import { visibleScreenshotRegion } from "../layout/screenshot.js";

const SLIDE_WIDTH_EMU = 12191695;
const SLIDE_HEIGHT_EMU = 6858000;

/**
 * Evaluate declared screenshot composition facts. This check deliberately does
 * not inspect pixels or claim that an audience can read the screenshot.
 */
export function analyzeScreenshotEvidence(project, placements = [], options = {}) {
  const threshold = options.minimumFocalCoverage ?? 0.03;
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]));
  const byPageAndAsset = new Map(placements.map((item) => [`${item.page}:${item.asset_id}`, item]));
  const usages = [];
  const findings = [];

  for (const page of project.pages ?? []) {
    for (const slot of page.asset_slots ?? []) {
      const asset = assets.get(slot.asset_id);
      const semantics = asset?.screenshot_evidence;
      if (!semantics) continue;
      const evidencePurpose = slot.evidence_purpose ?? semantics.evidence_purpose;
      if (typeof evidencePurpose !== "string" || evidencePurpose.trim() === "" || !isNormalizedRegion(semantics.focal_region)) {
        findings.push(finding(page.page, asset.id, "screenshot-evidence-contract", "warning", {
          reason: typeof evidencePurpose !== "string" || evidencePurpose.trim() === "" ? "evidence-purpose-required" : "valid-focal-region-required",
          automated_claim: "Screenshot evidence metadata is incomplete; human readability was not assessed."
        }));
        continue;
      }
      const placement = byPageAndAsset.get(`${page.page}:${asset.id}`);
      const usage = { page: page.page, asset_id: asset.id, sha256: placement?.sha256 ?? asset.sha256, evidence_purpose: evidencePurpose };
      usages.push(usage);
      const treatments = Array.isArray(semantics.presentation_treatments) ? semantics.presentation_treatments : [];
      if (semantics.content_role === "read_required" && treatments.length === 0 && semantics.human_review_required !== true) {
        findings.push(finding(page.page, asset.id, "screenshot-reading-treatment", "warning", {
          evidence_purpose: evidencePurpose,
          automated_claim: "Read-required content has no declared treatment or human-review requirement; human readability was not assessed."
        }));
      }
      if (!placement) {
        findings.push(finding(page.page, asset.id, "screenshot-placement-unresolved", "warning", {
          evidence_purpose: evidencePurpose,
          automated_claim: "The screenshot placement could not be mapped; human readability was not assessed."
        }));
        continue;
      }
      const visible = visibleScreenshotRegion(semantics.focal_region, placement);
      const focalCoverage = visible.width * visible.height / (SLIDE_WIDTH_EMU * SLIDE_HEIGHT_EMU);
      if (focalCoverage < threshold) {
        findings.push(finding(page.page, asset.id, "screenshot-focal-coverage", "warning", {
          evidence_purpose: evidencePurpose,
          estimated_slide_coverage: Number(focalCoverage.toFixed(4)),
          minimum_slide_coverage: threshold,
          basis: "source focal region mapped through the rendered image crop",
          automated_claim: "Composition risk only; human readability was not assessed."
        }));
      }
      if (semantics.content_role === "read_required" && semantics.human_review_required === true) {
        findings.push(finding(page.page, asset.id, "screenshot-human-review-required", "note", {
          evidence_purpose: evidencePurpose,
          presentation_treatments: treatments,
          human_review_required: true,
          automated_claim: "Internal screenshot text requires human readability review."
        }));
      }
    }
  }

  const groups = new Map();
  for (const usage of usages) {
    const identity = usage.sha256 || `asset:${usage.asset_id}`;
    const group = groups.get(identity) ?? [];
    group.push(usage);
    groups.set(identity, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const purposePages = new Map();
    for (const usage of group) {
      const key = usage.evidence_purpose.trim().toLowerCase();
      const priorPages = purposePages.get(key) ?? [];
      if (priorPages.length > 0) {
        findings.push(finding(usage.page, usage.asset_id, "screenshot-evidence-repetition", "warning", {
          evidence_purpose: usage.evidence_purpose,
          repeated_from_pages: [...priorPages],
          screenshot_identity: usage.sha256 ? "sha256" : "asset_id",
          automated_claim: "Repeated screenshot evidence purpose detected; visual usefulness was not assessed."
        }));
      }
      priorPages.push(usage.page);
      purposePages.set(key, priorPages);
    }
  }

  return {
    status: findings.some(({ severity }) => severity === "warning") ? "findings" : "passed",
    scope: "declared-composition-only",
    human_readability_assessed: false,
    screenshot_usage_count: usages.length,
    findings
  };
}

function finding(page, assetId, check, severity, evidence) {
  return { page, asset_id: assetId, check, severity, evidence };
}

function isNormalizedRegion(region) {
  if (!region || typeof region !== "object") return false;
  const { x, y, width, height } = region;
  return [x, y, width, height].every(Number.isFinite)
    && x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= 1 && y + height <= 1;
}
