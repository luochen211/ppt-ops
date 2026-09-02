import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const skillUrl = new URL("../.agents/skills/ppt-agent/SKILL.md", import.meta.url);
const metadataUrl = new URL("../.agents/skills/ppt-agent/agents/openai.yaml", import.meta.url);
const toolingUrl = new URL("../.agents/skills/ppt-agent/references/tooling.md", import.meta.url);

test("repository exposes a Codex-native PPT agent skill", async () => {
  const [skill, metadata, tooling] = await Promise.all([
    fs.readFile(skillUrl, "utf8"),
    fs.readFile(metadataUrl, "utf8"),
    fs.readFile(toolingUrl, "utf8"),
  ]);

  assert.match(skill, /^---\nname: ppt-agent\ndescription: .+\n---/);
  assert.match(skill, /Codex conversation is the product interface/);
  assert.match(skill, /--format pptx/);
  assert.match(skill, /references\/tooling\.md/);
  assert.doesNotMatch(skill, /Web Workbench|browser app is the product interface/i);
  assert.match(metadata, /display_name: "PPT Agent"/);
  assert.match(tooling, /gitbrent\/PptxGenJS/);
  assert.match(tooling, /microsoft\/markitdown/);
});
