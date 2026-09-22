import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claimStatementHash, evaluateFactLedger, factLedgerRevision, reportFactLedgerImpact, validateFactLedger } from "../src/facts/ledger.js";
import { reviewProject } from "../src/review/index.js";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

const SOURCE_HASH = "a".repeat(64);
const CHANGED_HASH = "b".repeat(64);
const statement = "Revenue was $10 million in 2025.";
const sources = [{ id: "source-001", sha256: SOURCE_HASH }];
const pages = [{ id: "page-001", screen_text: { title: "Revenue", body: [statement] } }, { id: "page-002", screen_text: { title: "Context" } }];

function claim(overrides = {}) {
  return {
    id: "claim-revenue", revision: 1, statement, statement_sha256: claimStatementHash(statement), kind: "time_sensitive", status: "supported",
    validity: { mode: "date", verified_at: "2026-01-01T00:00:00.000Z", valid_until: "2026-06-30T23:59:59.000Z" },
    sources: [{ source_id: "source-001", locator: "#p=4", source_sha256: SOURCE_HASH }],
    bindings: [{ page_id: "page-001", field: "/screen_text/body/0" }],
    ...overrides
  };
}
function ledger(claims = [claim()]) { return { schema_version: "1.0", project_id: "demo", claims }; }

test("validates exact statement hashes, source ids and Page Spec field bindings", () => {
  assert.deepEqual(validateFactLedger(ledger(), { sources, pages }), []);
  const invalid = ledger([claim({ statement_sha256: CHANGED_HASH, bindings: [{ page_id: "page-001", field: "/screen_text/missing" }] })]);
  assert.deepEqual(validateFactLedger(invalid, { sources, pages }), [
    "claims[0].statement_sha256 does not match statement",
    "claims[0].bindings[0].field does not resolve on page-001: /screen_text/missing"
  ]);
});

test("evaluates date boundaries without treating expiry as falsity", () => {
  const current = evaluateFactLedger(ledger(), { at: "2026-06-30T23:59:59.000Z", sources, pages });
  const expired = evaluateFactLedger(ledger(), { at: "2026-07-01T00:00:00.000Z", sources, pages });
  assert.equal(current.claims[0].validity_status, "current");
  assert.equal(expired.claims[0].validity_status, "expired");
  assert.equal(expired.claims[0].assertion_status, "supported");
  assert.equal(expired.status, "needs_review");
  assert.equal(expired.blocker_claim_ids.length, 0);
});

test("keeps unknown, conflicted and unable-to-verify states explicit", () => {
  const result = evaluateFactLedger(ledger([
    claim({ id: "claim-unknown", validity: { mode: "unknown" } }),
    claim({ id: "claim-conflict", status: "conflicted", validity: { mode: "unknown" } }),
    claim({ id: "claim-unverifiable", status: "unable_to_verify", validity: { mode: "unknown" } })
  ]), { at: "2026-07-01T00:00:00.000Z", sources, pages });
  assert.deepEqual(result.claims.map(({ assertion_status, validity_status }) => ({ assertion_status, validity_status })), [
    { assertion_status: "supported", validity_status: "unknown" },
    { assertion_status: "conflicted", validity_status: "unknown" },
    { assertion_status: "unable_to_verify", validity_status: "unknown" }
  ]);
});

test("blocks only statuses named by explicit policy", () => {
  const advisory = evaluateFactLedger(ledger(), { at: "2026-07-01T00:00:00.000Z", sources, pages });
  const enforced = evaluateFactLedger(ledger(), { at: "2026-07-01T00:00:00.000Z", sources, pages, policy: { required_kinds: ["time_sensitive"], blocking_statuses: ["expired"] } });
  assert.deepEqual(advisory.blocker_claim_ids, []);
  assert.deepEqual(enforced.blocker_claim_ids, ["claim-revenue"]);
  assert.equal(enforced.status, "failed");
});

test("reports changed and missing source snapshots separately", () => {
  const changed = evaluateFactLedger(ledger(), { at: "2026-01-02T00:00:00.000Z", sources: [{ id: "source-001", sha256: CHANGED_HASH }], pages });
  const missing = evaluateFactLedger(ledger(), { at: "2026-01-02T00:00:00.000Z", sources: [], pages });
  assert.equal(changed.claims[0].source_integrity[0].status, "changed");
  assert.equal(missing.claims[0].source_integrity[0].status, "missing");
});

test("rejects a ledger attached to the wrong project", () => {
  assert.deepEqual(validateFactLedger(ledger(), { projectId: "another-project", sources, pages }), ["project_id does not match project: demo"]);
});

test("maps a changed claim to every bound page and audience artifact", () => {
  const before = ledger([claim({ bindings: [{ page_id: "page-001", field: "/screen_text/body/0" }, { page_id: "page-002", field: "/screen_text/title" }] })]);
  const afterStatement = "Revenue was $11 million in 2025.";
  const after = ledger([claim({ revision: 2, statement: afterStatement, statement_sha256: claimStatementHash(afterStatement), bindings: before.claims[0].bindings })]);
  const impact = reportFactLedgerImpact(before, after, { artifacts: [
    { id: "version-executive", kind: "version", variant_id: "executive", claim_ids: ["claim-revenue"] },
    { id: "version-workshop", kind: "version", variant_id: "workshop", claim_ids: ["claim-revenue"] }
  ] });
  assert.deepEqual(impact.changed_claim_ids, ["claim-revenue"]);
  assert.deepEqual(impact.affected_page_ids, ["page-001", "page-002"]);
  assert.deepEqual(impact.affected_artifacts.map(({ variant_id }) => variant_id), ["executive", "workshop"]);
});

test("Review pins the ledger revision and leaves policy enforcement opt-in", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-facts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = {
    root, contractModel: "v1", factLedger: ledger(), contracts: { sources, pages },
    project: { schema_version: "1.0", name: "demo", title: "Demo", format: "16:9", source_files: ["source.md"], theme_file: "theme.json", assets_file: "assets.json" },
    pages: [{ id: "page-001", page: 1, task: "Explain", three_second_message: "Revenue", relation: "hero", screen_text: pages[0].screen_text, visual_job: "Show revenue", asset_slots: [], status: "draft" }],
    assets: [], theme: { dimensions: { width: 13.333, height: 7.5 }, typography: { heading_font: "Aptos", body_font: "Aptos" }, colors: { background: "#ffffff", text: "#111111", accent: "#0055aa" }, spacing: { unit: 0.25, page_margin: 0.6 } }, referencedFiles: []
  };
  const report = await reviewProject(project, { render: false, factLedgerEvaluatedAt: "2026-07-01T00:00:00.000Z" });
  const check = report.automated_checks.find(({ id }) => id === "fact-ledger");
  assert.equal(check.required, false);
  assert.equal(check.status, "pending");
  assert.equal(check.evidence.ledger_revision, factLedgerRevision(project.factLedger));
  assert.equal(check.evidence.summary.expired, 1);
});

test("Frozen Version, Review and Handoff preserve one ledger revision end to end", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-fact-workflow-"));
  await initializeProject(root, { name: "fact-workflow", title: "Fact workflow" });
  await seedAcceptedBoundaryImages(root);
  const source = JSON.parse(await fs.readFile(path.join(root, "sources.json"), "utf8"))[0];
  const page = JSON.parse(await fs.readFile(path.join(root, "pages.json"), "utf8"))[0];
  const title = page.screen_text.title;
  const factLedger = {
    schema_version: "1.0", project_id: "fact-workflow", claims: [{
      id: "claim-title", revision: 1, statement: title, statement_sha256: claimStatementHash(title), kind: "timeless", status: "supported",
      validity: { mode: "timeless", verified_at: "2026-01-01T00:00:00.000Z" },
      sources: [{ source_id: source.id, locator: "#title", source_sha256: source.sha256 }],
      bindings: [{ page_id: page.id, field: "/screen_text/title" }]
    }]
  };
  await fs.writeFile(path.join(root, "fact-ledger.json"), JSON.stringify(factLedger));
  const service = await ApplicationService.open(root);
  t.after(async () => { service.close(); await fs.rm(root, { recursive: true, force: true }); });

  const version = await service.freezeVersion();
  const snapshot = JSON.parse(await fs.readFile(path.join(root, `.pptops/versions/${version.id}/snapshot.json`), "utf8"));
  assert.equal(factLedgerRevision(snapshot["fact-ledger.json"]), factLedgerRevision(factLedger));
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html"] });
  const { review } = await service.runReview(build.id);
  const factCheck = review.automated.find(({ id }) => id === "fact-ledger");
  assert.equal(factCheck.evidence.ledger_revision, factLedgerRevision(factLedger));
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "Synthetic fixture" } });
  const selection = await service.selectDelivery({ artifactType: "presentation", formats: ["html"], sourceId: build.id, sourceRevision: version.id, actor: "user", buildId: build.id });
  const handoff = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: selection.decision.id });
  const manifest = JSON.parse(await fs.readFile(handoff.manifest_file, "utf8"));
  assert.equal(manifest.fact_ledger.ledger_revision, factLedgerRevision(factLedger));
  assert.equal(manifest.fact_ledger.summary.current, 1);
});
