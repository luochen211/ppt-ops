import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const UPDATE_REMINDER_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const RESULT_STATUSES = new Set(["no-update", "update-available"]);

export async function checkUpdateReminder({ stateRoot, check, force = false, now = Date.now, ttlMs = UPDATE_REMINDER_TTL_MS }) {
  if (typeof check !== "function") throw new TypeError("check must be a function");
  const nowMs = typeof now === "function" ? Number(now()) : Number(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("now and ttlMs must be finite positive values");
  const attemptedAt = new Date(nowMs).toISOString();
  const cacheFile = path.join(stateRoot, "agent-check.json");
  let cache = { state: force ? "bypassed" : "missing" };

  if (!force) {
    cache = await readCache(cacheFile, nowMs, ttlMs);
    if (cache.state === "invalid") return invalidCacheResult(attemptedAt, cache.code);
    if (cache.state === "fresh") return present(cache.record.result, "fresh", cache.expiresAt);
  }

  let checked;
  try {
    checked = normalizeCheckResult(await check(), attemptedAt);
  } catch (error) {
    return degradedResult(attemptedAt, cache.state, error);
  }

  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const record = { schema_version: CACHE_SCHEMA_VERSION, checked_at: attemptedAt, result: checked };
  try {
    await writeCache(stateRoot, cacheFile, record);
  } catch {
    return { ...present(checked, "unavailable", expiresAt), diagnostic: safeDiagnostic("UPDATE_CACHE_WRITE_FAILED") };
  }
  return present(checked, "refreshed", expiresAt);
}

export async function clearUpdateReminderCache(stateRoot) {
  await fs.rm(path.join(stateRoot, "agent-check.json"), { force: true }).catch(() => {});
}

async function readCache(cacheFile, nowMs, ttlMs) {
  let raw;
  try { raw = await fs.readFile(cacheFile, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return { state: "missing" };
    return { state: "invalid", code: "UPDATE_CACHE_READ_FAILED" };
  }
  let record;
  try { record = JSON.parse(raw); }
  catch { return { state: "invalid", code: "UPDATE_CACHE_INVALID" }; }
  if (!isCacheRecord(record)) return { state: "invalid", code: "UPDATE_CACHE_INVALID" };
  const checkedAt = Date.parse(record.checked_at);
  if (!Number.isFinite(checkedAt) || checkedAt > nowMs) return { state: "invalid", code: "UPDATE_CACHE_INVALID" };
  const expiresAt = checkedAt + ttlMs;
  return nowMs < expiresAt
    ? { state: "fresh", record, expiresAt: new Date(expiresAt).toISOString() }
    : { state: "stale", record, expiresAt: new Date(expiresAt).toISOString() };
}

function isCacheRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || record.schema_version !== CACHE_SCHEMA_VERSION) return false;
  if (typeof record.checked_at !== "string" || !record.result || typeof record.result !== "object" || Array.isArray(record.result)) return false;
  const result = record.result;
  if (!RESULT_STATUSES.has(result.status) || typeof result.update_available !== "boolean") return false;
  if ((result.status === "update-available") !== result.update_available) return false;
  if (result.checked_at !== record.checked_at || typeof result.current_version !== "string" || typeof result.target_version !== "string") return false;
  return typeof result.tested_commit === "string" && /^[0-9a-f]{40}$/.test(result.tested_commit);
}

function normalizeCheckResult(result, checkedAt) {
  if (!result || typeof result !== "object" || typeof result.update_available !== "boolean") throw coded("UPDATE_CHECK_RESULT_INVALID");
  if (typeof result.current_version !== "string" || typeof result.target_version !== "string" || !/^[0-9a-f]{40}$/.test(result.commit)) {
    throw coded("UPDATE_CHECK_RESULT_INVALID");
  }
  return {
    status: result.update_available ? "update-available" : "no-update",
    checked_at: checkedAt,
    update_available: result.update_available,
    current_version: result.current_version,
    target_version: result.target_version,
    tested_commit: result.commit
  };
}

function present(result, cache, expiresAt) {
  const value = {
    command: "update-agent-check",
    ok: true,
    ...result,
    cache,
    expires_at: expiresAt
  };
  if (result.status === "update-available") {
    value.advisory = {
      message: `A tested PPT-Ops update is available at ${result.tested_commit}.`,
      choices: {
        preview: "node update.mjs preview",
        apply: "Ask the user for approval, then run node update.mjs apply",
        dismiss: "Continue without updating for this session"
      }
    };
  }
  return value;
}

function invalidCacheResult(attemptedAt, code) {
  return {
    command: "update-agent-check",
    ok: true,
    status: "invalid-cache",
    cache: "invalid",
    checked_at: null,
    attempted_at: attemptedAt,
    update_available: null,
    diagnostic: safeDiagnostic(code)
  };
}

function degradedResult(attemptedAt, cache, error) {
  return {
    command: "update-agent-check",
    ok: true,
    status: "offline-or-degraded",
    cache,
    checked_at: null,
    attempted_at: attemptedAt,
    update_available: null,
    diagnostic: safeDiagnostic(error?.code)
  };
}

function safeDiagnostic(code) {
  const known = {
    UPDATE_CACHE_INVALID: "cached update evidence is invalid; use --force to refresh it",
    UPDATE_CACHE_READ_FAILED: "cached update evidence could not be read; use --force to refresh it",
    UPDATE_CACHE_WRITE_FAILED: "update availability was checked, but its cache could not be saved",
    UPDATE_NETWORK_FAILED: "the remote update check is unavailable; retry later",
    UPDATE_NO_TESTED_COMMIT: "no tested main update could be selected",
    UPDATE_BASELINE_REQUIRED: "the local installation cannot be compared automatically",
    UPDATE_CHECK_RESULT_INVALID: "the update check returned invalid evidence",
    ENOENT: "a required local update-check tool is unavailable"
  };
  const safeCode = Object.hasOwn(known, code) ? code : "UPDATE_CHECK_FAILED";
  return { code: safeCode, message: known[safeCode] ?? "update availability could not be checked" };
}

async function writeCache(stateRoot, cacheFile, record) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, ".gitignore"), "*\n", { flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const temporary = `${cacheFile}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await fs.rename(temporary, cacheFile);
  } finally { await fs.rm(temporary, { force: true }); }
}

function coded(code) { const error = new Error(code); error.code = code; return error; }
