import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../core/project.js";

export class ProjectFileStore {
  constructor(projectRoot) { this.root = path.resolve(projectRoot); }

  async writeImmutable(relativePath, contents) {
    const destination = resolveProjectPath(this.root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temporary, contents, { flag: "wx" });
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`immutable file already exists: ${relativePath}`);
      throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return this.describe(relativePath);
  }

  async writeVersionSnapshot(versionId, snapshot) {
    return this.writeImmutable(path.join(".pptops", "versions", versionId, "snapshot.json"), `${stableJson(snapshot)}\n`);
  }

  async readVersionSnapshot(versionId) {
    const file = resolveProjectPath(this.root, path.join(".pptops", "versions", versionId, "snapshot.json"));
    return JSON.parse(await fs.readFile(file, "utf8"));
  }

  async diffVersions(leftVersionId, rightVersionId) {
    const [left, right] = await Promise.all([this.readVersionSnapshot(leftVersionId), this.readVersionSnapshot(rightVersionId)]);
    return diffValues(left, right);
  }

  async writeBuildArtifact(buildId, target, name, contents) {
    return this.writeImmutable(path.join(".pptops", "builds", buildId, target, name), contents);
  }

  async describe(relativePath) {
    const file = resolveProjectPath(this.root, relativePath);
    const contents = await fs.readFile(file);
    return { file: path.relative(this.root, file), bytes: contents.byteLength, sha256: crypto.createHash("sha256").update(contents).digest("hex") };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function diffValues(left, right, pointer = "") {
  if (stableJson(left) === stableJson(right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return [{ path: pointer || "/", before: left, after: right }];
  const keys = new Set(Array.isArray(left) && Array.isArray(right) ? [...left.keys(), ...right.keys()].map(String) : [...Object.keys(left), ...Object.keys(right)]);
  return [...keys].sort().flatMap((key) => diffValues(left[key], right[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}
