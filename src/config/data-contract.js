import fs from "node:fs/promises";
import path from "node:path";

export const DATA_MARKER = ".ppt-ops-data";

export const SYSTEM_PATHS = Object.freeze([
  ".agents/skills/ppt-agent",
  "src",
  "schemas",
  "test",
  "templates/system",
  "docs/system",
  ".github",
  "package.json",
  "package-lock.json"
]);

export const USER_PATHS = Object.freeze([
  "config/profile.yml",
  "config/custom.md",
  "templates/user"
]);

export async function findRepositoryRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (await isPptOpsRepository(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw contractError("PPT_OPS_REPOSITORY_NOT_FOUND", `cannot find PPT-Ops repository from: ${start}`);
    current = parent;
  }
}

export async function resolveDataRoot(options = {}) {
  const repositoryRoot = options.repositoryRoot
    ? path.resolve(options.repositoryRoot)
    : await findRepositoryRoot(options.cwd);
  const explicitRoot = cleanOptional(options.explicitRoot);
  const environmentRoot = cleanOptional((options.env ?? process.env).PPT_OPS_ROOT);
  const markerFile = path.join(repositoryRoot, DATA_MARKER);

  let source = "repository-default";
  let configured = "projects";
  if (explicitRoot) {
    source = "explicit";
    configured = explicitRoot;
  } else if (environmentRoot) {
    source = "environment";
    configured = environmentRoot;
  } else {
    const marker = await readOptionalMarker(markerFile);
    if (marker) {
      source = "marker";
      configured = marker;
    }
  }

  const root = path.resolve(repositoryRoot, configured);
  const manifest = createLayerManifest({ repositoryRoot, dataRoot: root });
  return { root, source, repositoryRoot, markerFile, manifest };
}

export function createLayerManifest({ repositoryRoot, dataRoot }) {
  const systemRoot = path.resolve(repositoryRoot);
  const userRoot = path.resolve(dataRoot);
  const system = SYSTEM_PATHS.map((entry) => path.resolve(systemRoot, entry));
  const user = [...USER_PATHS.map((entry) => path.resolve(systemRoot, entry)), userRoot];
  assertNoLayerOverlap(system, user);
  return Object.freeze({
    systemRoot,
    userRoot,
    system: Object.freeze(system),
    user: Object.freeze(user),
    projectRoot: userRoot
  });
}

export function resolveProjectRoot(dataRoot, projectPath) {
  assertSafeRelativePath(projectPath, "project path");
  return resolveContained(dataRoot, projectPath, "project path");
}

export function resolveContained(root, candidate, label = "path") {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw contractError("PPT_OPS_PATH_INVALID", `${label} must be a non-empty path`);
  }
  if (path.isAbsolute(candidate)) {
    throw contractError("PPT_OPS_PATH_ESCAPE", `${label} must be relative: ${candidate}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, candidate);
  if (!isWithin(base, resolved)) throw contractError("PPT_OPS_PATH_ESCAPE", `${label} escapes its root: ${candidate}`);
  return resolved;
}

export function assertSystemUpdatePaths(paths, manifest) {
  for (const candidate of paths) {
    const resolved = path.resolve(manifest.systemRoot, candidate);
    if (manifest.user.some((entry) => pathsOverlap(resolved, entry))) {
      throw contractError("PPT_OPS_UPDATE_TOUCHES_USER_DATA", `system update path overlaps user data: ${candidate}`);
    }
    if (!manifest.system.some((entry) => isWithin(entry, resolved))) {
      throw contractError("PPT_OPS_UPDATE_PATH_UNKNOWN", `path is outside the system update manifest: ${candidate}`);
    }
  }
}

export function mergeConfigLayers({ profile = {}, custom = {}, project = {}, invocation = {} } = {}) {
  return deepMerge(profile, custom, project, invocation);
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== "string" || value.trim() === "" || path.isAbsolute(value)) {
    throw contractError("PPT_OPS_PATH_ESCAPE", `${label} must be a non-empty relative path`);
  }
  if (value.split(/[\\/]+/).includes("..")) throw contractError("PPT_OPS_PATH_ESCAPE", `${label} cannot contain '..': ${value}`);
}

function assertNoLayerOverlap(system, user) {
  for (const systemPath of system) {
    for (const userPath of user) {
      if (pathsOverlap(systemPath, userPath)) {
        throw contractError("PPT_OPS_LAYER_OVERLAP", `system and user layers overlap: ${systemPath} <> ${userPath}`);
      }
    }
  }
}

function pathsOverlap(left, right) {
  return isWithin(left, right) || isWithin(right, left);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readOptionalMarker(markerFile) {
  try {
    const value = (await fs.readFile(markerFile, "utf8")).trim();
    if (!value || value.includes("\n") || value.includes("\r")) {
      throw contractError("PPT_OPS_MARKER_INVALID", `${DATA_MARKER} must contain exactly one non-empty path`);
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function isPptOpsRepository(directory) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
    return packageJson.name === "ppt-ops";
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "SyntaxError"].includes(error.code) || error instanceof SyntaxError) return false;
    throw error;
  }
}

function cleanOptional(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deepMerge(...layers) {
  const result = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) throw contractError("PPT_OPS_CONFIG_INVALID", "configuration layers must be objects");
    for (const [key, value] of Object.entries(layer)) {
      result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key], value) : clone(value);
    }
  }
  return result;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return deepMerge(value);
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
