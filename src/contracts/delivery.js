export const DELIVERY_MODES = Object.freeze(["live_talk", "workshop", "pitch", "leave_behind", "async"]);
export const INTERACTION_KINDS = Object.freeze(["audience_action", "question", "exercise", "demonstration", "feedback"]);

export const DEFAULT_DENSITY_GUIDANCE = Object.freeze({ character_limit: 700, shape_limit: 60 });
export const DELIVERY_MODE_DENSITY_GUIDANCE = Object.freeze({
  live_talk: Object.freeze({ character_limit: 420, shape_limit: 48 }),
  workshop: Object.freeze({ character_limit: 520, shape_limit: 54 }),
  pitch: Object.freeze({ character_limit: 360, shape_limit: 44 }),
  leave_behind: DEFAULT_DENSITY_GUIDANCE,
  async: Object.freeze({ character_limit: 620, shape_limit: 58 })
});

export function densityGuidanceFor(deliveryMode) {
  return DELIVERY_MODE_DENSITY_GUIDANCE[deliveryMode] ?? DEFAULT_DENSITY_GUIDANCE;
}

export function visibleCharacterCount(pageSpec, { boundary = false } = {}) {
  const screen = pageSpec?.screen_text ?? {};
  const values = boundary
    ? [screen.title]
    : [screen.title, screen.subtitle, pageSpec?.three_second_message, ...(screen.body ?? [])];
  return values.filter((value) => typeof value === "string").join(" ").length;
}

export function inspectDeliveryModeFit(project) {
  const deliveryMode = project?.project?.delivery_mode;
  if (!deliveryMode) {
    return {
      status: "pending",
      delivery_mode: null,
      reason: "Project does not declare delivery_mode; legacy density guidance remains in effect.",
      findings: []
    };
  }

  const guidance = densityGuidanceFor(deliveryMode);
  const pages = project.pages ?? [];
  const findings = pages.flatMap((page, index) => {
    const characters = visibleCharacterCount(page, { boundary: index === 0 || index === pages.length - 1 });
    return characters > guidance.character_limit
      ? [{
          page: page.page,
          check: "delivery-mode-density",
          severity: "warning",
          evidence: { delivery_mode: deliveryMode, characters, character_limit: guidance.character_limit }
        }]
      : [];
  });

  if (deliveryMode === "workshop" && !pages.some((page) => page.audience_interaction)) {
    findings.push({
      page: null,
      check: "workshop-interaction",
      severity: "warning",
      evidence: { delivery_mode: deliveryMode, reason: "No PageSpec declares audience_interaction." }
    });
  }

  return {
    status: findings.length === 0 ? "passed" : "failed",
    delivery_mode: deliveryMode,
    guidance,
    findings,
    summary: findings.length === 0
      ? `PageSpecs fit the automated ${deliveryMode} guidance.`
      : `${findings.length} delivery-mode guidance finding(s) require review.`
  };
}
