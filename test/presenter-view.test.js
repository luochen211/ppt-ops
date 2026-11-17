import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import vm from "node:vm";
import { buildHtml } from "../src/adapters/html.js";
import { readProject } from "../src/core/project.js";
import { escapeAction, createSyncMessage, deckKeyAction, formatClock, parseSyncMessage, SYNC_ACTIONS, timerCommand, timerElapsed } from "../src/adapters/html-runtime.js";

async function deckWithNotes(mutate = () => {}) {
  const project = await readProject(path.resolve("examples/demo-project"));
  project.pages.forEach((page, index) => { page.speaker_notes = `Secret script ${index + 1} <b>`; page.estimated_duration_seconds = 60 * (index + 1); });
  mutate(project);
  return { project, html: await buildHtml(project) };
}

function runtimeConfig(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="deck-runtime-config">([\s\S]*?)<\/script>/)[1]);
}

test("main deck DOM keeps speaker notes only inside an inert template", async () => {
  const { html } = await deckWithNotes();
  const template = html.match(/<template id="speaker-notes-data">[\s\S]*?<\/template>/)?.[0];
  assert.ok(template, "notes template is rendered");
  assert.match(template, /<article id="notes-1" data-page="1">/);
  assert.match(template, /Secret script 1 &lt;b&gt;/);
  assert.doesNotMatch(html.replace(template, ""), /Secret script/);
  assert.match(html, /href="\?view=notes"/);
});

test("rendered deck exposes discoverable live hotkeys and controls", async () => {
  const { html } = await deckWithNotes();
  for (const control of ["previous", "next", "fullscreen", "overview", "presenter", "help"]) assert.match(html, new RegExp(`data-nav="${control}"`));
  assert.match(html, /title="Slide overview \(I \/ G \/ Esc\)"/);
  assert.match(html, /<dt>Esc<\/dt><dd>Open overview \/ close overlay \/ clear jump<\/dd>/);
  assert.match(html, /\.thumb-stage \.slide\{[^}]*color:var\(--text\)/, "thumbnails keep the slide text colour instead of the overlay's white");
  assert.match(html, /\.overview-grid\{[^}]*minmax\(min\(420px,100%\),1fr\)/);
  assert.match(html, /title="Presenter view \(N\)"/);
  assert.match(html, /title="Keyboard shortcuts \(\?\)"/);
  assert.match(html, /<div class="keymap" hidden role="dialog"[\s\S]*<dt>B<\/dt><dd>Blackout \/ restore screen<\/dd>/);
  assert.match(html, /<dt>I \/ G<\/dt>/);
  assert.match(html, /<dt>N<\/dt><dd>Open presenter view<\/dd>/);
  assert.match(html, /<div class="presenter-keys"><h3>Presenter window<\/h3><dl><dt>!<\/dt><dd>Mark slide: hard to deliver/);
  assert.match(html, /<dt>E<\/dt><dd>Export delivery record \(JSON\)<\/dd>/);
  assert.match(html, /<div class="blackout" hidden/);
  assert.match(html, /view === "presenter"/);
  assert.match(html, /new BroadcastChannel\(storageKey\)/);
  assert.match(html, /addEventListener\("storage"/);
  assert.match(html, /target\.postMessage\(message, "\*"\)/);
  // The inlined runtime must be valid script.
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test("deck key resolver maps live keys without clobbering fullscreen or typing", () => {
  const none = {};
  const cases = { ArrowRight: "next", " ": "next", PageDown: "next", ArrowLeft: "previous", PageUp: "previous", Home: "first", End: "last", f: "fullscreen", F: "fullscreen", b: "blackout", B: "blackout", i: "overview", g: "overview", G: "overview", n: "presenter", N: "presenter", "?": "help", 7: "digit", 0: "digit", Enter: "enter", Escape: "escape", Backspace: "backspace", x: null, p: null };
  for (const [key, action] of Object.entries(cases)) assert.equal(deckKeyAction(key, none, false), action, key);
  assert.equal(deckKeyAction("b", none, true), null, "typing in an input is ignored");
  assert.equal(deckKeyAction("f", { metaKey: true }, false), null, "browser shortcuts are left alone");
  assert.equal(deckKeyAction("n", { ctrlKey: true }, false), null);
  assert.equal(deckKeyAction("?", { shiftKey: true }, false), "help");
});

test("Esc opens the overview unless a jump, help panel or overview is already open", () => {
  assert.equal(escapeAction({}), "open-overview");
  assert.equal(escapeAction({ overviewOpen: true }), "close-overview");
  assert.equal(escapeAction({ helpOpen: true, overviewOpen: true }), "close-help", "help sits above the overview");
  assert.equal(escapeAction({ jumping: true, helpOpen: true }), "clear-jump", "a pending slide jump is cleared first");
});

test("sync message format is versioned, deck-scoped and validated", () => {
  assert.deepEqual(SYNC_ACTIONS, ["hello", "state", "go", "blackout", "timer", "record"]);
  const timer = { running: true, started_at: 1000, accumulated_ms: 0 };
  const message = createSyncMessage("deck1", "a", 3, "state", { index: 2, count: 5, blackout: true, timer });
  assert.deepEqual(Object.keys(message), ["protocol", "version", "deck", "sender", "seq", "action", "index", "count", "blackout", "timer", "sent_at"]);
  assert.equal(message.protocol, "pptops-presenter");
  assert.equal(message.version, 1);
  assert.deepEqual(parseSyncMessage(message, "deck1", "b"), message);
  assert.deepEqual(parseSyncMessage(JSON.stringify(message), "deck1", "b"), message, "localStorage fallback carries JSON");
  assert.equal(parseSyncMessage(message, "deck1", "a"), null, "own messages are ignored");
  assert.equal(parseSyncMessage(message, "other", "b"), null, "other decks are ignored");
  assert.equal(parseSyncMessage({ ...message, version: 2 }, "deck1", "b"), null);
  assert.equal(parseSyncMessage({ ...message, timer: { running: "yes" } }, "deck1", "b"), null);
  assert.equal(parseSyncMessage("not json", "deck1", "b"), null);
  assert.ok(parseSyncMessage(createSyncMessage("deck1", "p", 1, "go", { index: 4 }), "deck1", "d"));
  assert.equal(parseSyncMessage(createSyncMessage("deck1", "p", 1, "go", { index: "4" }), "deck1", "d"), null);
  assert.ok(parseSyncMessage(createSyncMessage("deck1", "p", 2, "blackout", { value: false }), "deck1", "d"));
  assert.ok(parseSyncMessage(createSyncMessage("deck1", "p", 3, "timer", { command: "pause" }), "deck1", "d"));
  assert.equal(parseSyncMessage(createSyncMessage("deck1", "p", 4, "timer", { command: "explode" }), "deck1", "d"), null);
  assert.ok(parseSyncMessage(createSyncMessage("deck1", "p", 5, "hello"), "deck1", "d"));
  assert.equal(parseSyncMessage(createSyncMessage("deck1", "p", 6, "eval"), "deck1", "d"), null);
});

test("timer keeps running across pauses and only resets on explicit reset", () => {
  let timer = timerCommand({ running: false, started_at: null, accumulated_ms: 0 }, "start", 1000);
  assert.equal(timerElapsed(timer, 61000), 60000);
  timer = timerCommand(timer, "pause", 61000);
  assert.equal(timerElapsed(timer, 999999), 60000);
  timer = timerCommand(timer, "resume", 100000);
  assert.equal(timerElapsed(timer, 105000), 65000);
  assert.equal(timerCommand(timer, "start", 200000), timer, "start is idempotent");
  assert.equal(timerElapsed(timerCommand(timer, "reset", 300000), 300000), 0);
  assert.equal(formatClock(65000), "1:05");
  assert.equal(formatClock(3725000), "1:02:05");
  assert.equal(formatClock(-5000), "-0:05");
});

test("presenter remaining time uses talk budget, else summed estimates, else none", async () => {
  const estimated = runtimeConfig((await deckWithNotes()).html);
  assert.deepEqual(estimated.budget, { seconds: 180, source: "page_estimates" });
  assert.deepEqual(estimated.estimates, [60, 120]);
  assert.deepEqual(estimated.pages.map((page) => page.page), [1, 2]);
  assert.deepEqual(estimated.rehearsed, [null, null], "no delivery recorded yet");
  assert.match(estimated.deck_id, /^[0-9a-z]+$/);
  const budgeted = runtimeConfig((await deckWithNotes((project) => { project.project.talk_budget = { total_minutes: 20 }; })).html);
  assert.deepEqual(budgeted.budget, { seconds: 1200, source: "talk_budget" });
  const partial = runtimeConfig((await deckWithNotes((project) => { delete project.pages[1].estimated_duration_seconds; })).html);
  assert.equal(partial.budget, null);
  assert.deepEqual(partial.estimates, [60, null]);
});
