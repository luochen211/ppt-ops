import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const skillRoot = new URL("../.agents/skills/ppt-agent/", import.meta.url);
const skillUrl = new URL("SKILL.md", skillRoot);
const metadataUrl = new URL("agents/openai.yaml", skillRoot);
const toolingUrl = new URL("references/tooling.md", skillRoot);
const routingUrl = new URL("references/routing-contract.json", skillRoot);
const dataContractUrl = new URL("references/data-contract.md", skillRoot);
const visualQualityUrl = new URL("references/visual-quality.md", skillRoot);
const visualAssetsUrl = new URL("references/visual-assets.md", skillRoot);
const expectedModes = ["discovery", "new", "intake", "outline", "design", "prototype", "revise", "build", "review", "handoff", "archive", "doctor"];

test("repository exposes one conversation-native PPT agent router", async () => {
  const [skill, metadata, tooling] = await Promise.all([
    fs.readFile(skillUrl, "utf8"),
    fs.readFile(metadataUrl, "utf8"),
    fs.readFile(toolingUrl, "utf8")
  ]);

  assert.match(skill, /^---\nname: ppt-agent\ndescription: .+\n---/);
  assert.match(skill, /\$ppt-agent.*only user-facing entry/);
  assert.match(skill, /Codex conversation is the product interface/);
  assert.match(skill, /references\/routing-contract\.json/);
  assert.match(skill, /references\/modes\/<mode>\.md/);
  assert.match(skill, /HTML is never an intermediate representation for PPTX/);
  assert.match(skill, /Web Workbench is outside the product/);
  assert.doesNotMatch(skill, /open (?:a|the) (?:web|browser)|launch (?:a|the) (?:web|browser)/i);
  assert.match(metadata, /display_name: "PPT Agent"/);
  assert.match(tooling, /gitbrent\/PptxGenJS/);
  assert.match(tooling, /microsoft\/markitdown/);
});

test("every route has one progressive Mode reference and bounded context", async () => {
  const routing = JSON.parse(await fs.readFile(routingUrl, "utf8"));
  assert.deepEqual(Object.keys(routing.modes), expectedModes);

  for (const mode of expectedModes) {
    const contract = routing.modes[mode];
    const procedure = await fs.readFile(new URL(`references/modes/${mode}.md`, skillRoot), "utf8");
    assert.match(procedure, new RegExp(`^# .+ Mode`));
    assert.ok(contract.intents.length > 0, `${mode} needs intents`);
    assert.ok(contract.loads.includes("shared"), `${mode} must load shared rules`);
    assert.ok(contract.forbids.length > 0, `${mode} needs a negative context boundary`);
  }
});

test("design, prototype, and review progressively load the guizang-informed visual quality rules", async () => {
  const [routing, reference] = await Promise.all([
    fs.readFile(routingUrl, "utf8").then(JSON.parse),
    fs.readFile(visualQualityUrl, "utf8")
  ]);
  for (const mode of ["design", "prototype", "review"]) assert.ok(routing.modes[mode].loads.includes("visual_quality"));
  assert.match(reference, /guizang-ppt-skill/);
  assert.match(reference, /three-second message/);
  assert.match(reference, /page rhythm/);
  assert.match(reference, /copy an object, edit text, play the deck, and confirm fonts/);
  assert.match(reference, /never a substitute for a named human decision/);
  assert.match(reference, /do not copy WebGL.*web-only machinery into PPTX/);
});

test("visual-producing and review modes load the controlled visual asset workflow", async () => {
  const [routing, reference] = await Promise.all([
    fs.readFile(routingUrl, "utf8").then(JSON.parse),
    fs.readFile(visualAssetsUrl, "utf8")
  ]);
  for (const mode of ["design", "prototype", "revise", "build", "review", "handoff"]) assert.ok(routing.modes[mode].loads.includes("visual_assets"));
  assert.match(reference, /page `visual_job` and three-second message come first/);
  assert.match(reference, /visual-asset-prepare/);
  assert.match(reference, /visual-asset-ingest/);
  assert.match(reference, /only after an explicit accept/i);
  assert.match(reference, /restrained faceted low-poly editorial illustration/);
  assert.match(reference, /Microsoft PowerPoint acceptance/);
  assert.match(reference, /native-sufficient/);
  assert.match(reference, /generated-needed/);
  assert.match(reference, /generated-present/);
  assert.match(reference, /empty ImageGen inventory can never pass/);
  assert.match(reference, /first and final page are mandatory exceptions/);
  assert.match(reference, /image-led, not ordinary title slides/);
  assert.match(reference, /Visible slide copy is exactly one title/);
  assert.match(reference, /occupy the majority of the composed page/);
  assert.match(reference, /Before freezing a Version/);
});

test("review audits ImageGen decisions without generating or accepting assets", async () => {
  const review = await fs.readFile(new URL("references/modes/review.md", skillRoot), "utf8");
  assert.match(review, /including when `assets\.json` or every `asset_slots` list is empty/);
  assert.match(review, /Review does not call an image provider or mutate asset state/);
  assert.match(review, /explicit user acceptance/);
  assert.match(review, /asset hash.*exact rendered Build/s);
});

test("routing starts multi-stage work from the earliest unmet prerequisite", async () => {
  const routing = JSON.parse(await fs.readFile(routingUrl, "utf8"));
  assert.equal(route(routing, "请直接生成pptx并交付", {}), "new");
  assert.equal(route(routing, "请直接生成pptx并交付", { project: true }), "intake");
  assert.equal(route(routing, "请直接生成pptx并交付", { project: true, sources: true }), "outline");
  assert.equal(route(routing, "请直接生成pptx并交付", { project: true, sources: true, outline: true }), "design");
  assert.equal(route(routing, "请直接生成pptx", { project: true, sources: true, outline: true, design: true }), "build");
  assert.equal(route(routing, "请交付", { project: true, build: true }), "review");
  assert.equal(route(routing, "请交付", { project: true, build: true, review: true }), "handoff");
});

test("unknown intent falls back to discovery without broad context", async () => {
  const routing = JSON.parse(await fs.readFile(routingUrl, "utf8"));
  assert.equal(route(routing, "帮我看看下一步怎么办", { project: true }), "discovery");
  assert.deepEqual(routing.modes.discovery.loads, ["shared", "current_request"]);
  assert.ok(routing.modes.discovery.forbids.includes("historical_projects"));
});

test("project resolution uses the shared resolver and forbids project guessing", async () => {
  const contract = await fs.readFile(dataContractUrl, "utf8");
  assert.match(contract, /src\/config\/data-contract\.js/);
  assert.match(contract, /explicit invocation root.*PPT_OPS_ROOT.*\.ppt-ops-data.*projects\//s);
  assert.match(contract, /Never choose a project by scanning private directories/);
  assert.match(contract, /Reject absolute project paths, `\.\.`, escape/);
});

test("content-only review can inspect sources before production exists", async () => {
  const routing = JSON.parse(await fs.readFile(routingUrl, "utf8"));
  for (const intent of routing.modes.review.variants.content_only.intents) {
    assert.equal(route(routing, `请检查${intent}`, { project: true, sources: true }), "review.content_only");
    assert.equal(route(routing, `请检查${intent}`, { project: true }), "intake");
  }
  assert.equal(route(routing, "请检查验收", { project: true, sources: true }), "build");
  assert.equal(route(routing, "请调整第 3 页配色", { project: true, sources: true, outline: true, design: true }), "revise");
  assert.ok(!routing.artifact_order.includes("content_review"));
  for (const mode of Object.values(routing.modes)) assert.ok(!mode.requires.includes("content_review"));
});

test("content review references resolve without bundling an external skill", async () => {
  const routing = JSON.parse(await fs.readFile(routingUrl, "utf8"));
  for (const mode of ["outline", "design", "revise", "review"]) {
    assert.ok(routing.modes[mode].loads.includes("content_review"));
    const procedure = await fs.readFile(new URL(`references/modes/${mode}.md`, skillRoot), "utf8");
    assert.match(procedure, /content-review\.md/);
  }
  const reference = await fs.readFile(new URL("references/content-review.md", skillRoot), "utf8");
  for (const target of [...reference.matchAll(/`(content-review[^`]+\.md)`/g)]) {
    assert.ok((await fs.stat(new URL(`references/${target[1]}`, skillRoot))).isFile());
  }
  for (const name of ["dbs-jtbd", "dbs-theory-grounding", "dbs-skill-maker"]) {
    assert.match(reference, new RegExp(name));
    await assert.rejects(fs.access(new URL(`../${name}/SKILL.md`, skillRoot)), { code: "ENOENT" });
  }
  const variant = routing.modes.review.variants.content_only;
  assert.ok(!variant.loads.includes("build"));
  assert.ok(!variant.loads.includes("visual_assets"));
  assert.ok(variant.forbids.includes("build_generation"));
});

function route(contract, request, artifacts) {
  const normalized = request.toLowerCase();
  const matches = Object.entries(contract.modes)
    .flatMap(([mode, definition]) => [
      ...Object.entries(definition.variants ?? {}).flatMap(([variant, details]) => details.intents.map((intent) => ({ mode: `${mode}.${variant}`, definition: details, intent: intent.toLowerCase() }))),
      ...definition.intents.map((intent) => ({ mode, definition, intent: intent.toLowerCase() }))
    ])
    .filter(({ intent }) => normalized.includes(intent))
    .sort((left, right) => right.intent.length - left.intent.length);
  const requested = matches[0]?.mode ?? contract.fallback;
  const definition = matches[0]?.definition ?? contract.modes[requested];
  for (const artifact of definition.requires) {
    if (!artifacts[artifact]) return contract.produced_by[artifact];
  }
  return requested;
}
