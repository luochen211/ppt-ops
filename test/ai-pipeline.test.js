import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CandidatePipeline } from "../src/ai/pipeline.js";
import { HttpJsonProvider } from "../src/ai/providers/http-json.js";
import { InfrastructureStore } from "../src/infrastructure/store.js";

const page = (id = "page-001") => ({ contract_version: "1.0", kind: "page_spec", id, page: Number(id.slice(-3)), task: "Explain", three_second_message: "Old", relation: "hero", screen_text: { title: "Old title" }, visual_job: "Focus", source_refs: [], asset_slots: [], content_status: "draft", renderers: { html: {}, pptx: {} } });

test("pipeline sends only allowlisted data and keeps private raw text out by default", async (t) => {
  const fixture = await setup(t);
  let outgoing;
  const provider = { id: "fake", async generate(payload) { outgoing = payload; return { target_id: "page-001", patch: [{ op: "replace", path: "/screen_text/title", value: "New title" }], source_refs: [{ source_id: "source-001", locator: "line:1-2" }] }; } };
  const pipeline = new CandidatePipeline({ provider, store: fixture.store, projectId: "demo" });
  const target = { ...page(), private_notes: "DO NOT SEND", customer_chat: "SECRET CHAT" };
  const candidate = await pipeline.generate({ task: "copy_compression", target, instruction: "Shorten", sourceSegments: [{ source_id: "source-001", locator: "line:1-2", text: "PRIVATE SOURCE" }] });
  const serialized = JSON.stringify(outgoing);
  assert.doesNotMatch(serialized, /DO NOT SEND|SECRET CHAT|PRIVATE SOURCE/);
  assert.match(serialized, /text_sha256/);
  assert.deepEqual(Object.keys(outgoing.target.snapshot), ["screen_text"]);
  assert.equal(candidate.state, "awaiting_powerpoint_observation");
});

test("explicit source-text authorization includes only selected segments", async (t) => {
  const fixture = await setup(t);
  let outgoing;
  const provider = { async generate(payload) { outgoing = payload; return { target_id: "page-001", patch: [{ op: "replace", path: "/relation", value: "comparison" }] }; } };
  await new CandidatePipeline({ provider, store: fixture.store, projectId: "demo" }).generate({ task: "relation_recommendation", target: page(), sourceSegments: [{ source_id: "source-001", locator: "line:3", text: "Allowed excerpt", ignored: "Never" }], privacy: { allowSourceText: true } });
  assert.equal(outgoing.sources[0].text, "Allowed excerpt");
  assert.equal("ignored" in outgoing.sources[0], false);
});

test("invalid or out-of-scope provider output never creates a candidate or changes the draft", async (t) => {
  const fixture = await setup(t);
  const draft = page(); const before = structuredClone(draft);
  const provider = { async generate() { return { target_id: "page-001", patch: [{ op: "replace", path: "/id", value: "hijacked" }] }; } };
  await assert.rejects(new CandidatePipeline({ provider, store: fixture.store, projectId: "demo" }).generate({ task: "page_spec", target: draft }), /not allowed|forbidden/);
  assert.deepEqual(draft, before);
  assert.deepEqual(fixture.store.listEntities("demo", "candidate"), []);

  const unsafe = { async generate() { return { target_id: "page-001", patch: [{ op: "add", path: "/screen_text/__proto__/polluted", value: true }] }; } };
  await assert.rejects(new CandidatePipeline({ provider: unsafe, store: fixture.store, projectId: "demo" }).generate({ task: "copy_compression", target: draft }), /unsafe patch path/);
  assert.equal({}.polluted, undefined);
});

test("provider retries transient failures and records sanitized audit events", async (t) => {
  const fixture = await setup(t);
  let calls = 0; const events = [];
  const provider = { async generate() { calls++; if (calls === 1) throw Object.assign(new Error("secret provider detail"), { retryable: true, code: "TIMEOUT" }); return JSON.stringify({ target_id: "page-001", patch: [{ op: "replace", path: "/template_id", value: "template-hero" }] }); } };
  await new CandidatePipeline({ provider, store: fixture.store, projectId: "demo", audit: (event) => events.push(event) }).generate({ task: "template_recommendation", target: page() });
  assert.equal(calls, 2);
  assert.ok(events.some((event) => event.type === "ai.request.failed" && event.code === "TIMEOUT"));
  assert.doesNotMatch(JSON.stringify(events), /secret provider detail/);
});

test("candidate requires acceptance, checks its base, and only changes the target draft", async (t) => {
  const fixture = await setup(t);
  const target = page("page-001"); const other = page("page-002"); const otherBefore = structuredClone(other);
  const provider = { async generate() { return { target_id: "page-001", patch: [{ op: "replace", path: "/screen_text/title", value: "Approved title" }] }; } };
  const pipeline = new CandidatePipeline({ provider, store: fixture.store, projectId: "demo" });
  const candidate = await pipeline.generate({ task: "copy_compression", target });
  assert.throws(() => pipeline.apply(candidate.id, target), /only accepted/);
  pipeline.observeInPowerPoint(candidate.id, { application: "Microsoft PowerPoint", artifact: "candidate.pptx", pages: [1] });
  pipeline.decide(candidate.id, { decision: "accept", rawFeedback: "Use this version", evalCategory: "user_acceptance", rootCause: "process" });
  const updated = pipeline.apply(candidate.id, target);
  assert.equal(updated.screen_text.title, "Approved title");
  assert.deepEqual(other, otherBefore);
  assert.throws(() => pipeline.apply(candidate.id, { ...target, task: "Changed since generation" }), /only accepted|draft changed/);
});

test("HTTP provider requires HTTPS and maps retryable statuses without leaking response bodies", async () => {
  assert.throws(() => new HttpJsonProvider({ url: "http://example.com", model: "test" }), /HTTPS/);
  const provider = new HttpJsonProvider({ url: "https://provider.example/v1", model: "test", apiKey: "secret", fetchImpl: async (_url, request) => {
    assert.equal(request.headers.authorization, "Bearer secret"); return { ok: false, status: 429 };
  } });
  await assert.rejects(provider.generate({ task: "outline" }), (error) => error.retryable === true && !error.message.includes("secret"));
});

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-ai-"));
  const store = new InfrastructureStore(path.join(root, "state.sqlite")); store.registerProject({ id: "demo", root, title: "Demo" });
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store };
}
