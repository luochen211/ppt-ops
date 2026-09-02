import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createV1Entity, validateV1Entity } from "../contracts/v1.js";
import { resolveProjectPath } from "../core/project.js";
import { compileVisualPrompt, normalizeVisualBrief, visualBriefId } from "./prompt.js";
import { detectRaster, inspectRaster } from "./raster.js";

const VISUAL_CHECKS = Object.freeze([
  "semantic_action", "subject_count", "identity_boundary", "visible_text_or_logo",
  "reference_invariants", "edge_integration", "copy_safe_space"
]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export class VisualAssetPipeline {
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  async prepare(input) {
    await this.assertV1Project();
    const brief = normalizeVisualBrief(input);
    const id = visualBriefId(brief);
    const compiled = compileVisualPrompt(brief);
    try {
      const existing = await this.readPrepared(id);
      if (existing.prompt.prompt_sha256 !== compiled.prompt_sha256) throw conflictError(`brief id collision: ${id}`);
      return existing;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const briefRecord = createV1Entity("visual_asset_brief", id, { ...brief, created_at: this.now() });
    const errors = validateV1Entity(briefRecord, "visual_asset_brief");
    if (errors.length) throw contractError(errors);
    const promptRecord = {
      contract_version: "1.0", kind: "visual_asset_prompt", id: `prompt-${id}`,
      brief_id: id, prompt: compiled.prompt, prompt_sha256: compiled.prompt_sha256,
      sections: compiled.sections, created_at: this.now()
    };
    await writeImmutableJson(this.briefFile(id), briefRecord);
    await writeImmutableJson(this.promptFile(id), promptRecord);
    return { brief: briefRecord, prompt: promptRecord };
  }

  async generate(input, provider, options = {}) {
    if (!provider?.generate) throw new TypeError("visual provider.generate is required");
    const prepared = await this.prepare(input);
    const references = await this.resolveReferences(prepared.brief);
    const maxAttempts = options.maxAttempts ?? 2;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const generationId = this.generationId();
      const request = providerRequest(prepared, references);
      try {
        const result = await provider.generate(request);
        return await this.persistCandidate(generationId, prepared, {
          ...result, provider: result?.provider ?? provider.id, model: result?.model ?? provider.model
        }, references, { attempt, source: "provider" });
      } catch (error) {
        lastError = error;
        await this.persistProviderFailure(generationId, prepared, provider, references, attempt, error);
        if (error.retryable !== true || attempt === maxAttempts) break;
      }
    }
    throw lastError;
  }

  async ingest(briefId, { sourceFile, provider = "external", model = "unknown", mime } = {}) {
    const prepared = await this.readPrepared(briefId);
    if (typeof sourceFile !== "string" || sourceFile.trim() === "") throw new TypeError("sourceFile is required");
    const references = await this.resolveReferences(prepared.brief);
    const bytes = await fs.readFile(path.resolve(sourceFile));
    return this.persistCandidate(this.generationId(), prepared, { bytes, provider, model, mime }, references, { attempt: 1, source: "ingest" });
  }

  async recordVisualObservation(generationId, input) {
    const generation = await this.readGeneration(generationId);
    if (generation.state !== "awaiting_visual_observation") throw stateError(`generation is not ready for visual observation: ${generation.state}`);
    if (!generation.inspection?.passed) throw stateError("generation failed automated raster validation");
    if (!input || !["agent", "human"].includes(input.actor)) throw new TypeError("visual observation actor must be agent or human");
    if (!["pass", "fail"].includes(input.verdict)) throw new TypeError("visual observation verdict must be pass or fail");
    if (await this.latestRecord("observations", generationId)) throw stateError("a visual observation is already recorded for this generation");
    const checks = Object.fromEntries(VISUAL_CHECKS.map((key) => [key, input.checks?.[key]]));
    if (Object.values(checks).some((value) => typeof value !== "boolean")) throw new TypeError(`visual observation checks must include booleans for: ${VISUAL_CHECKS.join(", ")}`);
    if (input.verdict === "pass" && Object.values(checks).some((value) => value !== true)) throw new TypeError("a passing visual observation requires every visual check to pass");
    const observation = createV1Entity("visual_asset_observation", `visual-observation-${this.idFactory()}`, {
      generation_id: generationId, actor: input.actor, verdict: input.verdict,
      candidate_file: generation.output_file, candidate_sha256: generation.inspection.sha256,
      checks, notes: String(input.notes ?? ""), created_at: this.now()
    });
    const errors = validateV1Entity(observation, "visual_asset_observation");
    if (errors.length) throw contractError(errors);
    await writeImmutableJson(path.join(this.evidenceRoot(), "observations", generationId, `${observation.id}.json`), observation);
    return observation;
  }

  async recordUserDecision(generationId, input) {
    const generation = await this.readGeneration(generationId);
    if (!input || !["accept", "continue_iteration", "reject"].includes(input.decision)) throw new TypeError("decision must be accept, continue_iteration, or reject");
    if (typeof input.raw_feedback !== "string" || input.raw_feedback.trim() === "") throw new TypeError("raw_feedback is required");
    if (await this.latestRecord("decisions", generationId)) throw stateError("a user decision is already recorded for this generation");
    const latestObservation = await this.latestRecord("observations", generationId);
    if (input.decision === "accept" && (!generation.inspection?.passed || latestObservation?.verdict !== "pass")) {
      throw stateError("acceptance requires passing automated validation and a passing visual observation");
    }
    const decision = createV1Entity("visual_asset_decision", `visual-decision-${this.idFactory()}`, {
      generation_id: generationId, actor: "user", decision: input.decision,
      raw_feedback: input.raw_feedback.trim(), observation_id: latestObservation?.id,
      created_at: this.now()
    });
    const errors = validateV1Entity(decision, "visual_asset_decision");
    if (errors.length) throw contractError(errors);
    await writeImmutableJson(path.join(this.evidenceRoot(), "decisions", generationId, `${decision.id}.json`), decision);
    return decision;
  }

  async registerAccepted(generationId, input) {
    const generation = await this.readGeneration(generationId);
    const prepared = await this.readPrepared(generation.brief_id);
    const decision = await this.latestRecord("decisions", generationId);
    if (decision?.decision !== "accept" || decision.actor !== "user") throw stateError("only an explicitly user-accepted generation may be registered");
    for (const field of ["asset_id", "page_id", "slot_role", "alt"]) if (typeof input?.[field] !== "string" || input[field].trim() === "") throw new TypeError(`${field} is required`);
    for (const field of ["asset_id", "page_id", "slot_role"]) if (!ID_PATTERN.test(input[field])) throw new TypeError(`${field} must be a stable lowercase identifier`);
    if (input.page_id !== prepared.brief.page_id || input.slot_role !== prepared.brief.slot_role) throw conflictError("registration page and slot must match the generation brief");
    const fit = input.fit ?? "contain";
    if (!["contain", "cover"].includes(fit)) throw new TypeError("fit must be contain or cover");

    const projectFile = path.join(this.projectRoot, "project.json");
    const assetsFile = path.join(this.projectRoot, "assets.json");
    const pagesFile = path.join(this.projectRoot, "pages.json");
    const [project, assets, pages] = await Promise.all([readJson(projectFile), readJson(assetsFile), readJson(pagesFile)]);
    if (assets.some((asset) => asset.id === input.asset_id) || project.asset_ids.includes(input.asset_id)) throw conflictError(`asset id already exists: ${input.asset_id}`);
    const pageIndex = pages.findIndex((page) => page.id === input.page_id);
    if (pageIndex < 0) throw conflictError(`unknown page: ${input.page_id}`);

    const extension = generation.inspection.extension;
    const relativeDestination = `assets/generated/${input.asset_id}${extension}`;
    const destination = resolveProjectPath(this.projectRoot, relativeDestination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const source = resolveProjectPath(this.projectRoot, generation.output_file);
    const currentSourceHash = crypto.createHash("sha256").update(await fs.readFile(source)).digest("hex");
    if (currentSourceHash !== generation.inspection.sha256) throw conflictError("generated candidate changed after inspection");
    await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL).catch((error) => {
      if (error.code === "EEXIST") throw conflictError(`asset destination already exists: ${relativeDestination}`);
      throw error;
    });

    const asset = createV1Entity("asset", input.asset_id, {
      type: "generated_image", file: relativeDestination, mime: generation.inspection.mime,
      sha256: generation.inspection.sha256, bytes: generation.inspection.bytes,
      width: generation.inspection.width, height: generation.inspection.height, alt: input.alt.trim(),
      provenance: {
        brief_id: generation.brief_id, generation_id: generation.id, prompt_sha256: generation.prompt_sha256,
        provider: generation.provider, model: generation.model, decision_id: decision.id
      }
    });
    const errors = validateV1Entity(asset, "asset");
    if (errors.length) { await fs.unlink(destination); throw contractError(errors); }
    const nextProject = { ...project, asset_ids: [...project.asset_ids, asset.id] };
    const nextAssets = [...assets, asset];
    const targetPage = pages[pageIndex];
    const nextSlots = [...(targetPage.asset_slots ?? []).filter((slot) => slot.role !== input.slot_role), { role: input.slot_role, asset_id: asset.id, fit }];
    const nextPages = pages.map((page, index) => index === pageIndex ? { ...page, asset_slots: nextSlots } : page);
    try {
      await writeJsonTransaction([[projectFile, nextProject], [assetsFile, nextAssets], [pagesFile, nextPages]]);
      const registration = {
        contract_version: "1.0", kind: "visual_asset_registration", id: `visual-registration-${this.idFactory()}`,
        generation_id: generationId, decision_id: decision.id, asset_id: asset.id, page_id: input.page_id,
        slot_role: input.slot_role, fit, file: relativeDestination, sha256: asset.sha256, created_at: this.now()
      };
      await writeImmutableJson(path.join(this.evidenceRoot(), "registrations", `${registration.id}.json`), registration);
      return { asset, page: nextPages[pageIndex], registration };
    } catch (error) {
      await writeJsonTransaction([[projectFile, project], [assetsFile, assets], [pagesFile, pages]]).catch(() => {});
      await fs.unlink(destination).catch(() => {});
      throw error;
    }
  }

  async readGeneration(generationId) {
    assertStableId(generationId, "generation id");
    return readJson(path.join(this.evidenceRoot(), "generations", generationId, "manifest.json"));
  }

  async assertV1Project() {
    const project = await readJson(path.join(this.projectRoot, "project.json"));
    if (project.contract_version !== "1.0" || project.kind !== "project") throw new Error("Visual Asset Pipeline requires a V1 project");
    return project;
  }

  async readPrepared(briefId) {
    assertStableId(briefId, "brief id");
    const [brief, prompt] = await Promise.all([readJson(this.briefFile(briefId)), readJson(this.promptFile(briefId))]);
    return { brief, prompt };
  }

  async resolveReferences(brief) {
    if (brief.mode !== "reference_edit") return [];
    const assets = await readJson(path.join(this.projectRoot, "assets.json"));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const references = [];
    for (const assetId of brief.reference_asset_ids) {
      const asset = byId.get(assetId);
      if (!asset) throw conflictError(`unknown reference asset: ${assetId}`);
      const absolutePath = resolveProjectPath(this.projectRoot, asset.file);
      const bytes = await fs.readFile(absolutePath);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (asset.sha256 && asset.sha256 !== sha256) throw conflictError(`reference asset hash changed: ${assetId}`);
      references.push({ asset_id: assetId, file: asset.file, path: absolutePath, sha256 });
    }
    return references;
  }

  async persistCandidate(generationId, prepared, result, references, attempt) {
    if (!result?.bytes) throw new TypeError("visual provider result.bytes is required");
    const bytes = Buffer.from(result.bytes);
    const detected = detectRaster(bytes);
    const extension = detected.extension ?? ".bin";
    const directory = path.join(this.evidenceRoot(), "generations", generationId);
    const outputFile = path.join(directory, `candidate${extension}`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(outputFile, bytes, { flag: "wx" });
    const inspection = await inspectRaster(this.projectRoot, outputFile, {
      aspect_ratio: prepared.brief.aspect_ratio,
      ratio_tolerance: prepared.brief.ratio_tolerance,
      transparency_required: prepared.brief.transparency_required,
      mime: result.mime
    });
    const manifest = createV1Entity("visual_asset_generation", generationId, {
      brief_id: prepared.brief.id, prompt_sha256: prepared.prompt.prompt_sha256,
      mode: prepared.brief.mode, state: inspection.passed ? "awaiting_visual_observation" : "validation_failed",
      provider: result.provider ?? "provider", model: result.model ?? "unknown",
      attempt: attempt.attempt, source: attempt.source, output_file: inspection.file,
      reference_assets: references.map(({ asset_id, file, sha256 }) => ({ asset_id, file, sha256 })),
      parent_generation_id: prepared.brief.parent_generation_id,
      change_scope: prepared.brief.change_scope, invariants: prepared.brief.invariants,
      inspection, created_at: this.now()
    });
    const errors = validateV1Entity(manifest, "visual_asset_generation");
    if (errors.length) throw contractError(errors);
    await writeImmutableJson(path.join(directory, "manifest.json"), manifest);
    return manifest;
  }

  async persistProviderFailure(generationId, prepared, provider, references, attempt, error) {
    const manifest = createV1Entity("visual_asset_generation", generationId, {
      brief_id: prepared.brief.id, prompt_sha256: prepared.prompt.prompt_sha256,
      mode: prepared.brief.mode, state: "provider_failed", provider: provider.id ?? "provider",
      model: provider.model ?? "unknown", attempt, source: "provider",
      reference_assets: references.map(({ asset_id, file, sha256 }) => ({ asset_id, file, sha256 })),
      error: { code: error.code ?? "PROVIDER_FAILED", message: error.message, retryable: error.retryable === true },
      created_at: this.now()
    });
    await writeImmutableJson(path.join(this.evidenceRoot(), "generations", generationId, "manifest.json"), manifest);
  }

  async latestRecord(kind, generationId) {
    const directory = path.join(this.evidenceRoot(), kind, generationId);
    let files;
    try { files = await fs.readdir(directory); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readJson(path.join(directory, file))));
    return records.sort((left, right) => `${left.created_at}:${left.id}`.localeCompare(`${right.created_at}:${right.id}`)).at(-1);
  }

  evidenceRoot() { return path.join(this.projectRoot, ".pptops", "visual-assets"); }
  briefFile(id) { return path.join(this.evidenceRoot(), "briefs", `${id}.json`); }
  promptFile(id) { return path.join(this.evidenceRoot(), "prompts", `${id}.json`); }
  generationId() { return `visual-generation-${this.idFactory()}`; }
}

function providerRequest(prepared, references) {
  return {
    contract_version: "1.0", task: "visual_asset_generation", mode: prepared.brief.mode,
    brief_id: prepared.brief.id, prompt: prepared.prompt.prompt,
    aspect_ratio: prepared.brief.aspect_ratio, width: prepared.brief.width, height: prepared.brief.height,
    references: references.map(({ asset_id, path: referencePath, sha256 }) => ({ asset_id, path: referencePath, sha256 }))
  };
}

async function writeImmutableJson(file, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, contents, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (await fs.readFile(file, "utf8") !== contents) throw conflictError(`immutable record already exists with different content: ${file}`);
  }
}

async function writeJsonTransaction(entries) {
  const originals = await Promise.all(entries.map(async ([file]) => [file, await fs.readFile(file)]));
  const suffix = `.tmp-${crypto.randomUUID()}`;
  const temporary = entries.map(([file, value]) => [file, `${file}${suffix}`, `${JSON.stringify(value, null, 2)}\n`]);
  await Promise.all(temporary.map(([, temp, contents]) => fs.writeFile(temp, contents, { flag: "wx" })));
  const committed = [];
  try {
    for (const [file, temp] of temporary) { await fs.rename(temp, file); committed.push(file); }
  } catch (error) {
    await Promise.all(originals.filter(([file]) => committed.includes(file)).map(([file, bytes]) => fs.writeFile(file, bytes)));
    throw error;
  } finally {
    await Promise.all(temporary.map(([, temp]) => fs.unlink(temp).catch(() => {})));
  }
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
function contractError(errors) { const error = new Error(`visual asset contract failed:\n${errors.map((item) => `- ${item}`).join("\n")}`); error.code = "VISUAL_ASSET_CONTRACT_FAILED"; return error; }
function stateError(message) { const error = new Error(message); error.code = "VISUAL_ASSET_STATE_INVALID"; return error; }
function conflictError(message) { const error = new Error(message); error.code = "VISUAL_ASSET_CONFLICT"; return error; }
function assertStableId(value, label) { if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${label} must be a stable lowercase identifier`); }
