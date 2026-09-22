import assert from "node:assert/strict";
import test from "node:test";
import { applyCitationManifest, buildCitationManifest, citationReviewEvidence } from "../src/citations/manifest.js";
import { claimStatementHash } from "../src/facts/ledger.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const pages = [page("page-001", 1), page("page-002", 2), page("page-003", 3)];
const sources = [{ id: "source-a", sha256: hashA }, { id: "source-b", sha256: hashB }];
const decision = { channels: ["on_slide", "speaker_notes", "appendix"], max_on_slide: 3, actor: "user:syna", decided_at: "2026-09-12T12:00:00Z" };
const metadata = {
  "source-a": { disclosure: "public", public_label: "Annual report", author_or_organization: "Example Org", title: "Annual Report", date: "2026", url: "https://example.test/report" },
  "source-b": { disclosure: "public", public_label: "Method", title: "Method Note" }
};

test("deduplicates one source shared by two claims and preserves page bindings", () => {
  const ledger = makeLedger([
    claim("claim-a", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }]),
    claim("claim-b", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }])
  ]);
  const first = buildCitationManifest({ ledger, sources, pages, decision, metadata });
  const second = buildCitationManifest({ ledger, sources, pages, decision, metadata });
  assert.equal(first.citations.length, 1);
  assert.deepEqual(first.citations[0].claim_ids, ["claim-a", "claim-b"]);
  assert.equal(first.revision, second.revision);
  assert.deepEqual(first.pages["page-002"].on_slide, ["cite-001"]);
});

test("keeps two sources for one claim as separately inspectable citations", () => {
  const ledger = makeLedger([claim("claim-a", [
    { source_id: "source-a", locator: "#p1", source_sha256: hashA },
    { source_id: "source-b", locator: "#p2", source_sha256: hashB }
  ], [{ page_id: "page-002", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources, pages, decision, metadata });
  assert.deepEqual(manifest.citations.map(({ source_id }) => source_id), ["source-a", "source-b"]);
});

test("restricted source remains internal and does not disclose locator or URL", () => {
  const ledger = makeLedger([claim("claim-a", [{ source_id: "source-a", locator: "C:/private/report.pdf#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources, pages, decision, metadata: { "source-a": { ...metadata["source-a"], disclosure: "restricted" } } });
  assert.equal(manifest.citations[0].status, "internal_only");
  assert.equal(manifest.citations[0].locator, null);
  assert.equal(manifest.citations[0].url, null);
  assert.deepEqual(manifest.citations[0].channels, ["internal_only"]);
});

test("changed source hash remains visible as source integrity evidence", () => {
  const ledger = makeLedger([claim("claim-a", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources: [{ id: "source-a", sha256: hashB }], pages, decision, metadata });
  assert.equal(manifest.citations[0].source_hash_matches, false);
  assert.equal(citationReviewEvidence(manifest).fact_validity_is_separate, true);
});

test("on-slide overflow fails visibly instead of shrinking", () => {
  const refs = ["a", "b"].map((suffix) => ({ source_id: `source-${suffix}`, locator: `#${suffix}`, source_sha256: suffix.repeat(64) }));
  const manifest = buildCitationManifest({ ledger: makeLedger([claim("claim-a", refs, [{ page_id: "page-002", field: "/screen_text/title" }])]), sources, pages, decision: { ...decision, channels: ["on_slide"], max_on_slide: 1 }, metadata });
  assert.throws(() => applyCitationManifest({ pages }, manifest), { code: "CITATION_REGION_OVERFLOW" });
});

test("speaker-note-only delivery stays outside visible slide citations", () => {
  const ledger = makeLedger([claim("claim-a", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources, pages, decision: { ...decision, channels: ["speaker_notes"] }, metadata });
  const project = applyCitationManifest({ pages });
  const rendered = applyCitationManifest({ pages }, manifest);
  assert.equal(project.pages[0].citation_entries, undefined);
  assert.deepEqual(rendered.pages[0].citation_entries, []);
  assert.match(rendered.pages[1].speaker_notes, /Annual Report/);
});

test("appendix numbering is stable when the same frozen evidence serves variants", () => {
  const ledger = makeLedger([claim("claim-a", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-002", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources, pages, decision: { ...decision, channels: ["appendix"] }, metadata });
  const executive = applyCitationManifest({ pages, variant: "executive" }, manifest);
  const workshop = applyCitationManifest({ pages, variant: "workshop" }, manifest);
  assert.equal(executive.pages.at(-1).screen_text.body[0], workshop.pages.at(-1).screen_text.body[0]);
  assert.equal(executive.pages.at(-1).page, 4);
});

test("title-only boundary pages reject visible citations", () => {
  const ledger = makeLedger([claim("claim-a", [{ source_id: "source-a", locator: "#p1", source_sha256: hashA }], [{ page_id: "page-001", field: "/screen_text/title" }])]);
  const manifest = buildCitationManifest({ ledger, sources, pages, decision: { ...decision, channels: ["on_slide"] }, metadata });
  assert.throws(() => applyCitationManifest({ pages }, manifest), { code: "CITATION_BOUNDARY_CONFLICT" });
});

function makeLedger(claims) { return { schema_version: "1.0", project_id: "demo", claims }; }
function claim(id, sources, bindings) { const statement = `Statement ${id}`; return { id, revision: 1, statement, statement_sha256: claimStatementHash(statement), kind: "time_sensitive", status: "supported", validity: { mode: "timeless" }, sources, bindings }; }
function page(id, number) { return { id, page: number, task: "Explain", three_second_message: "Message", relation: "sequence", screen_text: { title: `Page ${number}` }, visual_job: "Text", asset_slots: [], status: "approved", content_status: "accepted", renderers: { html: "default", pptx: "default" }, html: "default", pptx: "default" }; }
