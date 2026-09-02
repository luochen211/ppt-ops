import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildHtml } from "../src/adapters/html.js";
import { readProject } from "../src/core/project.js";

test("buildHtml creates a deterministic self-contained semantic deck", async () => {
  const project = await readProject(path.resolve("examples/demo-project"));
  const first = await buildHtml(project);
  const second = await buildHtml(project);

  assert.equal(first, second);
  assert.match(first, /^<!doctype html>/);
  assert.match(first, /width:1920px;height:1080px/);
  assert.match(first, /<main class="stage"/);
  assert.equal((first.match(/<section class="slide /g) ?? []).length, project.pages.length);
  assert.match(first, /<progress value="1" max="2"/);
  assert.match(first, /ArrowRight/);
  assert.match(first, /data-nav="fullscreen"/);
  assert.match(first, /requestFullscreen\|\|document\.documentElement\.webkitRequestFullscreen/);
  assert.match(first, /event\.key\.toLowerCase\(\)===['"]f['"]/);
  assert.match(first, /prefers-reduced-motion:reduce/);
  assert.match(first, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(first, /(?:src|href)="(?:\.\/|assets\/)/);
  assert.equal((first.match(/data-html-layout="boundary-image-dominant"/g) ?? []).length, 2);
  assert.match(first, /\.boundary-assets figure\{flex:0 0 68%;width:68%;height:96%/);
  const boundarySlides = [...first.matchAll(/<section class="slide boundary-slide[\s\S]*?<\/section>/g)].map((match) => match[0]);
  assert.equal(boundarySlides.length, 2);
  for (const slide of boundarySlides) {
    assert.equal((slide.match(/<h1\b/g) ?? []).length, 1);
    assert.doesNotMatch(slide, /subtitle|message|body-copy|slide-number|slide-footer/);
  }
  assert.doesNotMatch(boundarySlides[1], /HTML：预览与分享|PPTX：编辑与播放/);
});

test("buildHtml escapes shared text and asset labels", async () => {
  const project = await readProject(path.resolve("examples/demo-project"));
  project.project.title = '<unsafe & "title">';
  project.pages[0].screen_text.title = "<script>alert('x')</script>";
  project.assets[0].alt = 'mark "quoted"';
  const html = await buildHtml(project);

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(html, /mark &quot;quoted&quot;/);
});

test("buildHtml rejects assets outside the project root", async () => {
  const project = await readProject(path.resolve("examples/demo-project"));
  project.assets[0].file = "../outside.svg";
  await assert.rejects(buildHtml(project), /asset escapes project root/);
});
