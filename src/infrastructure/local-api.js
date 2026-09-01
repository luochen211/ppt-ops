import http from "node:http";

export function createLocalApi(store, options = {}) {
  const host = options.host ?? "127.0.0.1";
  if (!isLoopback(host)) throw new Error("local API may only bind to a loopback address");
  const server = http.createServer(async (request, response) => {
    try {
      await route(store, request, response);
    } catch (error) {
      send(response, error.statusCode ?? 400, { error: { code: error.code ?? "REQUEST_FAILED", message: error.message } });
    }
  });
  return {
    server,
    async listen(port = 0) {
      await new Promise((resolve, reject) => server.listen(port, host, resolve).once("error", reject));
      const address = server.address();
      return { host, port: address.port, url: `http://${host}:${address.port}/api/v1` };
    },
    async close() { if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  };
}

async function route(store, request, response) {
  const url = new URL(request.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/api/v1/health" && request.method === "GET") return send(response, 200, { status: "ok" });
  if (url.pathname === "/api/v1/projects" && request.method === "GET") return send(response, 200, { projects: store.listProjects() });
  if (url.pathname === "/api/v1/projects" && request.method === "POST") return send(response, 201, { project: store.registerProject(await body(request)) });
  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "projects" && parts[4] === "builds" && request.method === "GET") return send(response, 200, { builds: store.listBuilds(parts[3]) });
  if (url.pathname === "/api/v1/builds" && request.method === "POST") return send(response, 202, { build: store.enqueueBuild(await body(request)) });
  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "builds" && parts.length === 4 && request.method === "GET") {
    const build = store.getBuild(parts[3]);
    if (!build) return send(response, 404, { error: { code: "NOT_FOUND", message: "build not found" } });
    return send(response, 200, { build, attempts: store.listAttempts(parts[3]) });
  }
  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "builds" && parts[4] === "cancel" && request.method === "POST") return send(response, 200, { build: store.requestCancellation(parts[3]) });
  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "builds" && parts[4] === "retry" && request.method === "POST") return send(response, 202, { build: store.retryBuild(parts[3]) });
  if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "jobs" && parts[4] === "events" && request.method === "GET") return send(response, 200, { events: store.listEvents(parts[3], Number(url.searchParams.get("after") ?? 0)) });
  send(response, 404, { error: { code: "NOT_FOUND", message: "route not found" } });
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(response, status, value) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(`${JSON.stringify(value)}\n`); }
function isLoopback(host) { return ["127.0.0.1", "::1", "localhost"].includes(host); }
