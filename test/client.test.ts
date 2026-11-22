import { describe, expect, it } from "vitest";
import { LadooApiError, LadooClient, MissingApiKeyError } from "../src/client.js";
import { callList } from "./fixtures.js";
import { jsonResponse, mockApi } from "./mock-api.js";

const noSleep = async () => {};

describe("LadooClient", () => {
  it("sends the key, the pinned API version and the query", async () => {
    const api = mockApi({ "GET /v1/calls": callList });
    const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch });
    const page = await client.get("/v1/calls", { query: { outcome: "booked", limit: 5, cursor: undefined } });

    expect(page.next_cursor).toBe("cur_page2");
    const [req] = api.requests;
    expect(req?.headers.authorization).toBe("Bearer lsk_test_demo");
    expect(req?.headers["ladoo-version"]).toBe("2026-11-16");
    expect(req?.headers["user-agent"]).toMatch(/^ladoo-mcp\//);
    expect(req?.query).toEqual({ outcome: "booked", limit: "5" });
  });

  it("fills and encodes path parameters", async () => {
    const api = mockApi({ "GET /v1/people/{id}": {} });
    const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch });
    await client.get("/v1/people/{id}", { path: { id: "a/b" } });
    expect(api.requests[0]?.path).toBe("/v1/people/a%2Fb");
  });

  it("sends an Idempotency-Key on POSTs and reuses it on retries", async () => {
    let attempts = 0;
    const api = mockApi({
      "POST /v1/webhook-deliveries/{id}/redeliver": () =>
        ++attempts < 2 ? jsonResponse(503, { error: { code: "internal_error", message: "down" } }) : {},
    });
    const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch, sleep: noSleep });
    await client.post("/v1/webhook-deliveries/{id}/redeliver", { path: { id: "d1" } });

    const keys = api.requests.map((r) => r.headers["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("waits Retry-After on 429, then succeeds", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const api = mockApi({
      "GET /v1/agents": () =>
        ++attempts === 1
          ? jsonResponse(429, { error: { code: "rate_limited", message: "slow down" } }, { "Retry-After": "3" })
          : { data: [] },
    });
    const client = new LadooClient({
      apiKey: "lsk_test_demo",
      fetch: api.fetch,
      sleep: async (ms) => void waits.push(ms),
    });
    await expect(client.get("/v1/agents")).resolves.toEqual({ data: [] });
    expect(waits).toEqual([3000]);
  });

  it("gives up when Retry-After is longer than a tool call should wait", async () => {
    const api = mockApi({
      "GET /v1/agents": () =>
        jsonResponse(429, { error: { code: "rate_limited", message: "slow down" } }, { "Retry-After": "60" }),
    });
    const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch, sleep: noSleep });
    const error = await client.get("/v1/agents").catch((e) => e);
    expect(error).toBeInstanceOf(LadooApiError);
    expect(error.retryAfterSeconds).toBe(60);
    expect(api.requests).toHaveLength(1);
  });

  it("doesn't retry other 4xx errors and keeps the error's fields", async () => {
    const api = mockApi({
      "GET /v1/people": jsonResponse(403, {
        error: {
          code: "insufficient_scope",
          message: "API key lacks the 'people:read' scope",
          details: { required: "people:read" },
          request_id: "req_demo",
        },
      }),
    });
    const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch, sleep: noSleep });
    const error = await client.get("/v1/people").catch((e) => e);
    expect(api.requests).toHaveLength(1);
    expect(error).toMatchObject({
      status: 403,
      code: "insufficient_scope",
      details: { required: "people:read" },
      requestId: "req_demo",
    });
  });

  it("retries network errors, then throws the last one", async () => {
    let attempts = 0;
    const client = new LadooClient({
      apiKey: "lsk_test_demo",
      sleep: noSleep,
      fetch: async () => {
        attempts++;
        throw new TypeError("fetch failed");
      },
    });
    await expect(client.get("/v1/agents")).rejects.toThrow("fetch failed");
    expect(attempts).toBe(3);
  });

  it("refuses to send a request without a key", async () => {
    const api = mockApi({});
    const client = new LadooClient({ apiKey: "  ", fetch: api.fetch });
    await expect(client.get("/v1/agents")).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(api.requests).toHaveLength(0);
  });

  it("names an error with no JSON body by its status", async () => {
    const client = new LadooClient({
      apiKey: "lsk_test_demo",
      sleep: noSleep,
      maxRetries: 0,
      fetch: async () => new Response("Bad gateway", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(client.get("/v1/agents")).rejects.toMatchObject({ status: 502, code: "http_502" });
  });
});
