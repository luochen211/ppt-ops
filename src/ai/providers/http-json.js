export class HttpJsonProvider {
  constructor({ url, model, apiKey, timeoutMs = 30000, fetchImpl = fetch }) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) throw new Error("provider URL must use HTTPS unless it is loopback");
    this.id = `http-json:${model}`; this.url = parsed; this.model = model; this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async generate(payload) {
    const response = await this.fetch(this.url, {
      method: "POST", headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, input: payload, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const error = new Error(`provider request failed with HTTP ${response.status}`); error.code = "PROVIDER_HTTP_ERROR"; error.retryable = response.status === 429 || response.status >= 500; throw error;
    }
    const result = await response.json();
    return result.output ?? result;
  }
}
