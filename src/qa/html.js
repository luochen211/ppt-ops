import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 15000;
const ROLES = new Set(["connector", "content", "decorative", "node"]);
const ROLE_PAIRS = new Set(["connector:content", "connector:node", "content:content", "node:node"]);

export function analyzeHtmlGeometry(pages, options = {}) {
  const tolerance = options.tolerance ?? 1;
  const findings = [];
  for (const page of pages) {
    const ids = new Set();
    if (page.policy === "strict" && (page.elements?.length ?? 0) === 0) {
      findings.push(finding(page.page, "html-qa-coverage", "error", { reason: "strict-page-has-no-annotated-elements" }));
    }
    for (const element of page.elements ?? []) {
      if (!element.explicitId) findings.push(finding(page.page, "html-qa-contract", "error", { element: element.id, reason: "stable-data-qa-id-required" }));
      if (!ROLES.has(element.role)) findings.push(finding(page.page, "html-qa-contract", "error", { element: element.id, role: element.role, reason: "unknown-data-qa-role" }));
      if (ids.has(element.id)) findings.push(finding(page.page, "html-qa-contract", "error", { element: element.id, reason: "duplicate-data-qa-id" }));
      ids.add(element.id);
      if (element.role === "decorative" || element.allowAll) continue;
      if (isOutOfBounds(element.rect, page.rect, tolerance)) {
        findings.push(finding(page.page, "html-out-of-bounds", "error", {
          element: element.id,
          role: element.role,
          rect: element.rect,
          page_rect: page.rect
        }));
      }
    }
    for (const text of page.textElements ?? []) {
      if (text.allowClipping) continue;
      if (text.ownClipping && (text.scrollWidth > text.clientWidth + tolerance || text.scrollHeight > text.clientHeight + tolerance)) {
        findings.push(finding(page.page, "html-text-overflow", "error", {
          element: text.id,
          rect: text.rect,
          scroll_width: text.scrollWidth,
          scroll_height: text.scrollHeight,
          client_width: text.clientWidth,
          client_height: text.clientHeight,
          reason: "text-content-exceeds-own-box"
        }));
      }
      for (const clip of text.clippingAncestors ?? []) {
        if (isOutside(text.rect, clip.rect, tolerance)) {
          findings.push(finding(page.page, "html-text-clipping", "error", {
            element: text.id,
            clip_ancestor: clip.id,
            text_rect: text.rect,
            clip_rect: clip.rect,
            reason: "text-crosses-clipping-ancestor"
          }));
        }
      }
    }
    for (const element of page.elements ?? []) for (const target of element.allowWith ?? []) {
      if (!ids.has(target)) findings.push(finding(page.page, "html-qa-contract", "error", { element: element.id, target, reason: "allowlist-target-not-found" }));
    }
    const elements = (page.elements ?? []).filter((element) => element.role !== "decorative" && !element.allowAll);
    for (let left = 0; left < elements.length; left += 1) {
      for (let right = left + 1; right < elements.length; right += 1) {
        const a = elements[left];
        const b = elements[right];
        if (isAllowedPair(a, b) || isAllowedContainment(a, b)) continue;
        const pair = [a.role, b.role].sort().join(":");
        if (!ROLE_PAIRS.has(pair)) continue;
        const intersection = intersectRects(a.rect, b.rect);
        if (intersection.width <= tolerance || intersection.height <= tolerance) continue;
        const smallerArea = Math.min(area(a.rect), area(b.rect));
        const ratio = smallerArea > 0 ? area(intersection) / smallerArea : 0;
        const connectorPair = pair.startsWith("connector:");
        const threshold = connectorPair ? 0 : options.minimumOverlapRatio ?? 0.02;
        if (ratio <= threshold) continue;
        findings.push(finding(page.page, "html-unintended-overlap", "error", {
          left: a.id,
          left_role: a.role,
          right: b.id,
          right_role: b.role,
          intersection,
          overlap_ratio: Number(ratio.toFixed(4)),
          reason: connectorPair ? "connector-crosses-protected-element" : `${pair}-collision`
        }));
      }
    }
  }
  const annotatedPageCount = pages.filter((page) => (page.elements?.length ?? 0) > 0).length;
  return {
    status: findings.some(({ severity }) => severity === "error") ? "failed" : annotatedPageCount === 0 ? "degraded" : "passed",
    ...(findings.length === 0 && annotatedPageCount === 0 ? { reason: "No data-qa geometry annotations were found." } : {}),
    page_count: pages.length,
    annotated_page_count: annotatedPageCount,
    findings,
    pages: pages.map((page) => ({ page: page.page, annotated_element_count: page.elements?.length ?? 0, text_element_count: page.textElements?.length ?? 0, finding_count: findings.filter((item) => item.page === page.page).length }))
  };
}

export async function inspectHtmlPresentation({ htmlFile, browserPath, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const file = path.resolve(htmlFile);
  await fs.access(file);
  const executable = browserPath ?? await findBrowser();
  if (!executable) return { status: "degraded", reason: "Google Chrome or Chromium is unavailable", page_count: 0, annotated_page_count: 0, findings: [], pages: [] };
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-html-qa-"));
  const processHandle = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--window-size=1600,900",
    "about:blank"
  ], { stdio: "ignore" });
  try {
    const port = await waitForDebugPort(profile, processHandle, timeoutMs);
    const target = await waitForPageTarget(port, timeoutMs);
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await client.send("Network.enable");
      await client.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
      const url = `${pathToFileURL(file).href}?static=1`;
      await client.send("Page.navigate", { url });
      await waitForDocument(client, url, timeoutMs);
      const pages = await collectGeometry(client);
      return { ...analyzeHtmlGeometry(pages), browser: executable, html_file: file };
    } finally {
      client.close();
    }
  } finally {
    await terminateProcess(processHandle);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function findBrowser() {
  const candidates = [
    process.env.PPT_OPS_CHROME,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    process.platform === "darwin" ? "/Applications/Chromium.app/Contents/MacOS/Chromium" : undefined,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  return undefined;
}

async function waitForDebugPort(profile, processHandle, timeoutMs) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`browser exited before HTML QA started: ${processHandle.exitCode}`);
    try {
      const [port] = (await fs.readFile(file, "utf8")).trim().split("\n");
      if (Number(port) > 0) return Number(port);
    } catch {}
    await delay(50);
  }
  throw new Error("timed out waiting for browser debugging port");
}

async function waitForPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {}
    await delay(50);
  }
  throw new Error("timed out waiting for HTML page target");
}

async function waitForDocument(client, expectedUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", { expression: "({ready:document.readyState,url:location.href})", returnByValue: true });
    if (result.result.value?.ready === "complete" && result.result.value.url.startsWith(expectedUrl)) {
      await client.send("Runtime.evaluate", { expression: "document.fonts?.ready", awaitPromise: true, returnByValue: true });
      await delay(350);
      return;
    }
    await delay(50);
  }
  throw new Error("timed out waiting for HTML presentation");
}

async function terminateProcess(processHandle) {
  if (processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => processHandle.once("exit", resolve)),
    delay(750)
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
  if (processHandle.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => processHandle.once("exit", resolve)),
      delay(2000)
    ]);
  }
}

async function collectGeometry(client) {
  const expression = `(()=>{
    const slides = [...document.querySelectorAll('.slide')];
    return slides.map((slide, index) => {
      const sr = slide.getBoundingClientRect();
      const visible = (element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const annotated = [...slide.querySelectorAll('[data-qa-role]')];
      const ids = new Map(annotated.map((element, i) => [element, element.dataset.qaId || ('page-' + (slide.dataset.page || index + 1) + '-element-' + (i + 1))]));
      const idOf = (element) => element.dataset.qaId || element.id || ('page-' + (slide.dataset.page || index + 1) + '-text-' + ([...slide.querySelectorAll('*')].indexOf(element) + 1));
      const relative = (element) => {
        const r = element.getBoundingClientRect();
        return { x: r.left - sr.left, y: r.top - sr.top, width: r.width, height: r.height };
      };
      const clippingAncestors = (element) => {
        const result = [];
        for (let parent = element.parentElement; parent && parent !== slide; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (['hidden', 'clip'].includes(style.overflow) || ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)) {
            result.push({ id: idOf(parent), rect: relative(parent) });
          }
        }
        return result;
      };
      return {
        page: Number(slide.dataset.page) || index + 1,
        policy: slide.dataset.qaPolicy || 'advisory',
        rect: { x: 0, y: 0, width: sr.width, height: sr.height },
        elements: annotated.filter(visible).map((element) => ({
          id: ids.get(element), explicitId: Boolean(element.dataset.qaId), role: element.dataset.qaRole,
          rect: relative(element), allowAll: element.dataset.qaOverlap === 'allow',
          allowWith: (element.dataset.qaAllowOverlapWith || '').split(/\\s+/).filter(Boolean),
          ancestors: annotated.filter((parent) => parent !== element && parent.contains(element)).map((parent) => ids.get(parent))
        })),
        textElements: [...slide.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,button,a,label,figcaption,span')]
          .filter((element) => visible(element) && element.textContent.trim())
          .map((element) => ({
            id: idOf(element), rect: relative(element), scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
            clientWidth: element.clientWidth, clientHeight: element.clientHeight,
            ownClipping: ['hidden', 'clip'].includes(getComputedStyle(element).overflow) || ['hidden', 'clip'].includes(getComputedStyle(element).overflowX) || ['hidden', 'clip'].includes(getComputedStyle(element).overflowY),
            allowClipping: element.dataset.qaAllowClipping === 'true', clippingAncestors: clippingAncestors(element)
          }))
      };
    });
  })()`;
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.description ?? result.exceptionDetails.text ?? "HTML geometry collection failed");
  return result.result.value;
}

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    return new CdpClient(socket);
  }
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

function isAllowedPair(a, b) { return a.allowWith?.includes(b.id) || b.allowWith?.includes(a.id); }
function isAllowedContainment(a, b) { return a.role !== "connector" && b.role !== "connector" && (a.ancestors?.includes(b.id) || b.ancestors?.includes(a.id)); }
function isOutOfBounds(rect, page, tolerance) { return rect.x < -tolerance || rect.y < -tolerance || rect.x + rect.width > page.width + tolerance || rect.y + rect.height > page.height + tolerance; }
function isOutside(rect, boundary, tolerance) { return rect.x < boundary.x - tolerance || rect.y < boundary.y - tolerance || rect.x + rect.width > boundary.x + boundary.width + tolerance || rect.y + rect.height > boundary.y + boundary.height + tolerance; }
function intersectRects(a, b) {
  const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
function area(rect) { return Math.max(0, rect.width) * Math.max(0, rect.height); }
function finding(page, check, severity, evidence) { return { page, check, severity, evidence }; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
