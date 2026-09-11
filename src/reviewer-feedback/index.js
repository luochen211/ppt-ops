import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createV1Entity } from "../contracts/v1.js";
import { resolveProjectPath } from "../core/project.js";

const DECISIONS = new Set(["approve", "request_changes", "comment"]);
const DISCLOSURES = ["speaker_notes", "sources", "prior_feedback"];
const PACKAGE_SCHEMA = "1.0";

export async function createReviewerFeedbackPackage({ projectRoot, projectTitle, build, review, frozenProject, fileStore, priorFeedback, brief, now = new Date().toISOString() }) {
  if (build.state !== "succeeded") throw applicationError("BUILD_NOT_SUCCEEDED", "review package requires a succeeded build");
  if (review.build_id !== build.id) throw applicationError("REVIEW_BUILD_MISMATCH", "review package Build and Review do not match");
  const normalizedBrief = normalizeBrief(brief);
  const disclosures = normalizedBrief.disclosures;
  const buildManifest = await readAndHash(projectRoot, path.join(".pptops", "builds", build.id, "manifest.json"));
  const reviewManifest = await readAndHash(projectRoot, path.join(".pptops", "reviews", review.id, "manifest.json"));
  const sourceDeck = resolveProjectPath(projectRoot, path.join(".pptops", "builds", build.id, "html", "slides.html"));
  let deck;
  try { deck = await fs.readFile(sourceDeck); }
  catch (error) {
    if (error.code === "ENOENT") throw applicationError("REVIEW_PACKAGE_HTML_BUILD_REQUIRED", "the first review-package slice requires an existing HTML Build target; it will not rebuild a preview");
    throw error;
  }
  const sourceRelative = path.join(".pptops", "builds", build.id, "html", "slides.html");
  if (review.artifact_hashes?.[sourceRelative] !== hash(deck)) throw applicationError("REVIEW_SOURCE_CHANGED", "the HTML artifact must match the selected Review; run Review again for changed artifacts");
  assertDisclosureSafe(deck.toString("utf8"), frozenProject, priorFeedback, disclosures);
  const buildHash = hash(buildManifest.bytes);
  const reviewHash = hash(reviewManifest.bytes);
  const packageInput = {
    schema_version: PACKAGE_SCHEMA,
    build_id: build.id,
    build_sha256: buildHash,
    review_id: review.id,
    review_revision: review.revision,
    review_sha256: reviewHash,
    brief: normalizedBrief,
    prior_feedback: disclosures.prior_feedback ? priorFeedback.map(({ id, response_sha256 }) => ({ id, response_sha256 })) : []
  };
  const packageId = `review-package-${hash(stableJson(packageInput)).slice(0, 12)}`;
  const packageRoot = path.join(".pptops", "review-packages", packageId);
  const manifestPath = path.join(packageRoot, "manifest.json");
  try {
    const existing = JSON.parse(await fs.readFile(resolveProjectPath(projectRoot, manifestPath), "utf8"));
    await verifyPackageArtifacts(projectRoot, packageRoot, existing.included_artifacts);
    return { package_id: packageId, package_dir: path.dirname(resolveProjectPath(projectRoot, manifestPath)), entry_file: resolveProjectPath(projectRoot, path.join(packageRoot, "index.html")), manifest_file: resolveProjectPath(projectRoot, manifestPath), manifest: existing, reused: true };
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  const pages = frozenProject.pages.map((page, index) => ({
    human_reference: `slide-${index + 1}`,
    slide_number: index + 1,
    page_spec_id: page.id,
    page_number: page.page,
    title: page.screen_text.title
  }));
  const responseBindingHash = hash(stableJson(packageInput));
  const responseTemplate = buildResponseTemplate(packageId, responseBindingHash, pages);
  const entry = renderReviewerEntry({ projectTitle, packageId, normalizedBrief, pages, frozenProject, responseTemplate, priorFeedback: disclosures.prior_feedback ? priorFeedback : [] });
  const artifacts = {
    "deck.html": deck,
    "response-template.json": `${JSON.stringify(responseTemplate, null, 2)}\n`,
    "index.html": entry
  };
  const described = Object.entries(artifacts).map(([name, contents]) => ({ name, bytes: Buffer.byteLength(contents), sha256: hash(contents) }));
  const manifest = {
    schema_version: PACKAGE_SCHEMA,
    kind: "reviewer_feedback_package",
    package_id: packageId,
    created_at: now,
    build: { id: build.id, sha256: buildHash, manifest_sha256: buildManifest.sha256 },
    review: { id: review.id, revision: review.revision, sha256: reviewHash, manifest_sha256: reviewManifest.sha256 },
    response_binding_sha256: responseBindingHash,
    review_scope: normalizedBrief,
    disclosures,
    page_mapping: pages.map(({ human_reference, slide_number, page_spec_id, page_number }) => ({ human_reference, slide_number, page_spec_id, page_number })),
    included_artifacts: described,
    source_artifacts: [{ build_target: "html", source_sha256: hash(deck), packaged_name: "deck.html" }],
    source_artifacts_preserved: true,
    network_requests_required: false,
    identity_verification: "not_performed",
    acceptance_boundary: "Reviewer feedback is evidence only; it is not creator acceptance, automated QA, visual acceptance, real-PowerPoint acceptance, or final business approval.",
    accessibility: { status: "baseline_applied", evidence: "Semantic headings, labelled controls, keyboard-operable fields, focus indicators, and reduced-motion styling are included; no external accessibility audit is claimed." }
  };
  for (const [name, contents] of Object.entries(artifacts)) await fileStore.writeImmutable(path.join(packageRoot, name), contents);
  await fileStore.writeImmutable(manifestPath, `${stableJson(manifest)}\n`);
  return { package_id: packageId, package_dir: path.dirname(resolveProjectPath(projectRoot, manifestPath)), entry_file: resolveProjectPath(projectRoot, path.join(packageRoot, "index.html")), manifest_file: resolveProjectPath(projectRoot, manifestPath), manifest, reused: false };
}

export async function importReviewerResponse({ projectRoot, responseFile, fileStore, store, projectId, currentBuild }) {
  const rawText = await fs.readFile(path.resolve(responseFile), "utf8");
  let raw;
  try { raw = JSON.parse(rawText); }
  catch { throw applicationError("REVIEWER_RESPONSE_INVALID", "reviewer response must be valid JSON"); }
  const packageId = requirePackageId(raw.package_id);
  const manifestFile = resolveProjectPath(projectRoot, path.join(".pptops", "review-packages", packageId, "manifest.json"));
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw applicationError("REVIEW_PACKAGE_NOT_FOUND", `unknown review package: ${packageId}`);
    throw error;
  }
  validateBinding(raw, manifest);
  const normalized = normalizeResponse(raw, manifest.page_mapping);
  const responseHash = hash(stableJson(raw));
  const existing = store.listEntities(projectId, "reviewer_feedback").find((item) => item.response_sha256 === responseHash);
  if (existing) return { feedback: existing, stale: existing.stale, conflicts: existing.conflicts ?? [], reused: true };
  const allFeedback = store.listEntities(projectId, "reviewer_feedback");
  const conflicts = findConflicts(normalized, allFeedback.filter((item) => item.build_id === manifest.build.id));
  const stale = !currentBuild || currentBuild.id !== manifest.build.id;
  const id = `reviewer-feedback-${responseHash.slice(0, 12)}`;
  const relativeEvidence = path.join(".pptops", "reviewer-feedback", id, "response.json");
  await fileStore.writeImmutable(relativeEvidence, `${stableJson(raw)}\n`);
  const portableFeedback = createV1Entity("reviewer_feedback", id, {
    package_id: packageId,
    build_id: manifest.build.id,
    build_sha256: manifest.build.sha256,
    review_id: manifest.review.id,
    review_revision: manifest.review.revision,
    review_sha256: manifest.review.sha256,
    response_sha256: responseHash,
    response_file: relativeEvidence,
    reviewer: normalized.reviewer,
    identity_verified: false,
    ...(normalized.decision_time ? { decision_time: normalized.decision_time } : {}),
    overall: normalized.overall,
    pages: normalized.pages,
    stale,
    current_build_id: currentBuild?.id ?? null,
    conflicts
  });
  await fileStore.writeImmutable(path.join(".pptops", "reviewer-feedback", id, "manifest.json"), `${stableJson(portableFeedback)}\n`);
  const feedback = store.saveEntity(projectId, portableFeedback);
  return { feedback, stale, conflicts, reused: false };
}

function normalizeBrief(brief) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) throw applicationError("REVIEW_BRIEF_INVALID", "review brief must be a JSON object");
  for (const field of ["purpose", "audience", "scope"]) if (!hasText(brief[field])) throw applicationError("REVIEW_BRIEF_INVALID", `${field} is required in the review brief`);
  if (!Array.isArray(brief.requested_decisions) || brief.requested_decisions.length === 0 || brief.requested_decisions.some((item) => !hasText(item))) throw applicationError("REVIEW_BRIEF_INVALID", "requested_decisions must contain at least one plain-language question");
  if (!brief.disclosures || typeof brief.disclosures !== "object") throw applicationError("DISCLOSURE_SELECTION_REQUIRED", "explicit disclosure choices are required");
  for (const field of DISCLOSURES) if (typeof brief.disclosures[field] !== "boolean") throw applicationError("DISCLOSURE_SELECTION_REQUIRED", `disclosures.${field} must be explicitly true or false`);
  return {
    purpose: brief.purpose,
    audience: brief.audience,
    scope: brief.scope,
    requested_decisions: [...brief.requested_decisions],
    change_summary: Array.isArray(brief.change_summary) ? [...brief.change_summary] : hasText(brief.change_summary) ? [brief.change_summary] : [],
    ...(hasText(brief.deadline) ? { deadline: brief.deadline } : {}),
    disclosures: Object.fromEntries(DISCLOSURES.map((field) => [field, brief.disclosures[field]]))
  };
}

function buildResponseTemplate(packageId, responseBindingHash, pages) {
  return {
    schema_version: PACKAGE_SCHEMA,
    package_id: packageId,
    binding_sha256: responseBindingHash,
    reviewer: { name: "", role: "", contact: "" },
    decision_time: "",
    overall: { decision: null, comment: "" },
    pages: pages.map(({ human_reference, slide_number, title }) => ({ human_reference, slide_number, title, decision: null, comment: "" }))
  };
}

function normalizeResponse(raw, mapping) {
  if (raw.schema_version !== PACKAGE_SCHEMA) throw applicationError("REVIEWER_RESPONSE_INVALID", "unsupported reviewer response schema_version");
  const reviewer = Object.fromEntries(["name", "role", "contact"].filter((field) => hasText(raw.reviewer?.[field])).map((field) => [field, raw.reviewer[field]]));
  const overall = normalizeDecision(raw.overall, "overall");
  const mappingByReference = new Map(mapping.map((page) => [page.human_reference, page]));
  if (!Array.isArray(raw.pages)) throw applicationError("REVIEWER_RESPONSE_INVALID", "pages must be an array");
  const seen = new Set();
  const pages = raw.pages.filter((item) => item?.decision !== null || hasText(item?.comment)).map((item) => {
    const mapped = mappingByReference.get(item.human_reference);
    if (!mapped) throw applicationError("REVIEWER_RESPONSE_PAGE_UNKNOWN", `unknown page reference: ${item.human_reference}`);
    if (seen.has(item.human_reference)) throw applicationError("REVIEWER_RESPONSE_INVALID", `duplicate page response: ${item.human_reference}`);
    seen.add(item.human_reference);
    return { ...normalizeDecision(item, item.human_reference), human_reference: item.human_reference, slide_number: mapped.slide_number, page_spec_id: mapped.page_spec_id, page_number: mapped.page_number };
  });
  if (overall.decision === null && !hasText(overall.comment) && pages.length === 0) throw applicationError("REVIEWER_RESPONSE_EMPTY", "response must contain an explicit decision or comment");
  return { reviewer, ...(hasText(raw.decision_time) ? { decision_time: raw.decision_time } : {}), overall, pages };
}

function normalizeDecision(value, label) {
  const decision = value?.decision ?? null;
  if (decision !== null && !DECISIONS.has(decision)) throw applicationError("REVIEWER_RESPONSE_INVALID", `${label} decision must be approve, request_changes, comment, or null`);
  const comment = typeof value?.comment === "string" ? value.comment : "";
  if (decision === "comment" && !hasText(comment)) throw applicationError("REVIEWER_RESPONSE_INVALID", `${label} comment decision requires free-form text`);
  return { decision, comment };
}

function validateBinding(raw, manifest) {
  if (raw.binding_sha256 !== manifest.response_binding_sha256) {
    throw applicationError("REVIEWER_RESPONSE_BINDING_MISMATCH", "response does not match the immutable Build and Review recorded by its package");
  }
}

function findConflicts(incoming, existing) {
  const conflicts = [];
  for (const prior of existing) {
    if (opposed(incoming.overall.decision, prior.overall?.decision)) conflicts.push({ feedback_id: prior.id, scope: "deck", decisions: [prior.overall.decision, incoming.overall.decision] });
    const priorPages = new Map((prior.pages ?? []).map((page) => [page.human_reference, page]));
    for (const page of incoming.pages) {
      const previous = priorPages.get(page.human_reference);
      if (opposed(page.decision, previous?.decision)) conflicts.push({ feedback_id: prior.id, scope: page.human_reference, decisions: [previous.decision, page.decision] });
    }
  }
  return conflicts;
}

function opposed(left, right) { return (left === "approve" && right === "request_changes") || (left === "request_changes" && right === "approve"); }
function requirePackageId(value) {
  if (typeof value !== "string" || !/^review-package-[a-f0-9]{12}$/.test(value)) throw applicationError("REVIEWER_RESPONSE_INVALID", "package_id is invalid");
  return value;
}
async function readAndHash(root, relative) {
  const bytes = await fs.readFile(resolveProjectPath(root, relative));
  return { bytes, sha256: hash(bytes) };
}
async function verifyPackageArtifacts(root, packageRoot, artifacts) {
  if (!Array.isArray(artifacts)) throw applicationError("REVIEW_PACKAGE_INTEGRITY_FAILED", "review package manifest has no artifact inventory");
  for (const artifact of artifacts) {
    const bytes = await fs.readFile(resolveProjectPath(root, path.join(packageRoot, artifact.name)));
    if (bytes.byteLength !== artifact.bytes || hash(bytes) !== artifact.sha256) throw applicationError("REVIEW_PACKAGE_INTEGRITY_FAILED", `review package artifact changed: ${artifact.name}`);
  }
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
function applicationError(code, message) { const error = new Error(message); error.code = code; return error; }

function assertDisclosureSafe(html, project, priorFeedback, disclosures) {
  const excluded = [];
  if (!disclosures.speaker_notes) {
    excluded.push(...project.pages.map(page => page.speaker_notes));
    if (/<aside\b[^>]*\bid\s*=\s*["']speaker-notes["']/i.test(html)) {
      throw applicationError("REVIEW_PACKAGE_DISCLOSURE_UNSAFE", "the selected HTML Build contains speaker notes; select a reviewed artifact without notes or explicitly include them");
    }
  }
  if (!disclosures.sources) excluded.push(...project.pages.flatMap(page => (page.source_refs ?? []).map(ref => ref.locator)));
  if (!disclosures.prior_feedback) excluded.push(...priorFeedback.flatMap(item => [item.overall?.comment, ...(item.pages ?? []).map(page => page.comment)]));
  if (excluded.filter(hasText).some(value => html.includes(value) || html.includes(escapeHtml(value)))) {
    throw applicationError("REVIEW_PACKAGE_DISCLOSURE_UNSAFE", "the selected HTML Build contains excluded context; select a disclosure-safe reviewed artifact or change the explicit disclosure choices");
  }
}

function renderReviewerEntry({ projectTitle, packageId, normalizedBrief: brief, pages, frozenProject, responseTemplate, priorFeedback }) {
  const disclosureSummary = [
    brief.disclosures.speaker_notes ? "Speaker notes are included." : "Speaker notes are not included.",
    brief.disclosures.sources ? "Source citations are included." : "Source citations are not included.",
    brief.disclosures.prior_feedback ? "Earlier reviewer feedback is included." : "Earlier reviewer feedback is not included."
  ];
  const pageCards = pages.map((mapped, index) => {
    const page = frozenProject.pages[index];
    const notes = brief.disclosures.speaker_notes && hasText(page.speaker_notes) ? `<details><summary>Speaker notes</summary><p>${escapeHtml(page.speaker_notes)}</p></details>` : "";
    const sources = brief.disclosures.sources && page.source_refs?.length ? `<details><summary>Source citations</summary><ul>${page.source_refs.map((ref, sourceIndex) => `<li>Citation ${sourceIndex + 1}${hasText(ref.locator) ? ` — ${escapeHtml(ref.locator)}` : ""}</li>`).join("")}</ul></details>` : "";
    return `<section class="slide-card" id="${mapped.human_reference}"><h2>Slide ${mapped.slide_number}: ${escapeHtml(mapped.title)}</h2><iframe title="Preview of slide ${mapped.slide_number}" loading="lazy" src="deck.html#slide-${page.page}"></iframe>${notes}${sources}<fieldset data-page="${mapped.human_reference}"><legend>Feedback for slide ${mapped.slide_number}</legend>${decisionInputs(`page-${index}`)}<label>Comment<textarea name="page-comment-${index}" rows="3"></textarea></label></fieldset></section>`;
  }).join("\n");
  const earlier = priorFeedback.length ? `<section><h2>Earlier reviewer feedback</h2>${priorFeedback.map((item) => {
    const pageFeedback = (item.pages ?? []).map((page) => `<li>${escapeHtml(humanizeReference(page.human_reference))}: ${escapeHtml(page.decision ?? "comment only")}${hasText(page.comment) ? ` — ${escapeHtml(page.comment)}` : ""}</li>`).join("");
    return `<article><h3>${escapeHtml(item.reviewer?.name ?? "Unnamed reviewer")}</h3><p>${escapeHtml(item.overall?.decision ?? "comment only")}${item.stale ? " (response to an older build)" : ""}</p>${hasText(item.overall?.comment) ? `<p>${escapeHtml(item.overall.comment)}</p>` : ""}${pageFeedback ? `<ul>${pageFeedback}</ul>` : ""}</article>`;
  }).join("")}</section>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; img-src data:; base-uri 'none'; form-action 'none'"><title>Feedback requested: ${escapeHtml(projectTitle)}</title><style>${entryCss()}</style></head>
<body><header><p class="eyebrow">Presentation review</p><h1>${escapeHtml(projectTitle)}</h1><p>${escapeHtml(brief.purpose)}</p><dl><div><dt>Audience</dt><dd>${escapeHtml(brief.audience)}</dd></div><div><dt>Review scope</dt><dd>${escapeHtml(brief.scope)}</dd></div>${brief.deadline ? `<div><dt>Reply requested by</dt><dd>${escapeHtml(brief.deadline)}</dd></div>` : ""}<div><dt>Version</dt><dd>Fixed package ${escapeHtml(packageId.slice(-12))}</dd></div></dl><p class="notice">This is a fixed review copy. Your response will not edit the presentation, and reviewer approval remains separate from the creator's acceptance and final business approval.</p></header>
<main><section><h2>Decisions requested</h2><ul>${brief.requested_decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><section><h2>What changed</h2>${brief.change_summary.length ? `<ul>${brief.change_summary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>No change summary was supplied.</p>"}</section><section><h2>Included context</h2><ul>${disclosureSummary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>${earlier}<form id="feedback"><section><h2>Your details</h2><p>Only enter details you choose to supply. This package does not verify identity.</p><div class="grid"><label>Name<input name="reviewer-name"></label><label>Role<input name="reviewer-role"></label><label>Contact<input name="reviewer-contact"></label><label>Decision time<input name="decision-time" placeholder="For example, 2026-09-15T14:00:00Z"></label></div></section><section><h2>Overall response</h2><fieldset><legend>Deck-level decision</legend>${decisionInputs("overall")}<label>Overall comment<textarea name="overall-comment" rows="4"></textarea></label></fieldset></section>${pageCards}<section><h2>Return your feedback</h2><p>Select Download response, then return the JSON file to the presentation creator. Opening this package or leaving comments does not count as approval.</p><button type="submit">Download response JSON</button><p id="status" role="status" aria-live="polite"></p></section></form></main><script>${entryScript(responseTemplate)}</script></body></html>\n`;
}

function decisionInputs(name) { return `<div class="choices"><label><input type="radio" name="${name}-decision" value="approve">Approve</label><label><input type="radio" name="${name}-decision" value="request_changes">Request changes</label><label><input type="radio" name="${name}-decision" value="comment">Comment only</label></div>`; }
function entryScript(template) { return `const template=${JSON.stringify(template).replaceAll("<", "\\u003c")};document.getElementById('feedback').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);const value=name=>form.get(name)||null;const text=name=>String(form.get(name)||'');const response=structuredClone(template);response.reviewer={name:text('reviewer-name'),role:text('reviewer-role'),contact:text('reviewer-contact')};response.decision_time=text('decision-time');response.overall={decision:value('overall-decision'),comment:text('overall-comment')};response.pages=response.pages.map((page,index)=>({...page,decision:value('page-'+index+'-decision'),comment:text('page-comment-'+index)}));const hasFeedback=response.overall.decision||response.overall.comment.trim()||response.pages.some(page=>page.decision||page.comment.trim());const status=document.getElementById('status');if(!hasFeedback){status.textContent='Add an overall or slide-level decision or comment before downloading.';return}const blob=new Blob([JSON.stringify(response,null,2)+'\\n'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='review-response.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);status.textContent='Response downloaded. Return that JSON file to the presentation creator.'});`; }
function entryCss() { return `:root{color-scheme:light;--ink:#172033;--muted:#536071;--line:#cbd5e1;--accent:#174ea6;--surface:#f8fafc}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:17px/1.6 system-ui,sans-serif}header,main{width:min(1100px,calc(100% - 32px));margin:auto}header{padding:56px 0 28px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;color:var(--accent);font-weight:700}h1{font-size:clamp(2rem,5vw,3.75rem);line-height:1.05}h2{margin-top:0}section,.notice{margin:24px 0;padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}dl,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}dt{font-weight:700}dd{margin:0}.notice{border-left:6px solid var(--accent)}.slide-card iframe{display:block;width:100%;aspect-ratio:16/9;border:1px solid var(--line);background:#111}.choices{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px}label{display:grid;gap:6px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:10px;border:1px solid #8996a8;border-radius:6px}button{padding:12px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}details{margin:12px 0}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}@media print{button{display:none}}`; }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function humanizeReference(value) { const match = /^slide-(\d+)$/.exec(value ?? ""); return match ? `Slide ${match[1]}` : "Slide"; }
