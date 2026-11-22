import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import * as f from "./fixtures.js";
import { jsonResponse } from "./mock-api.js";
import { connect } from "./session.js";

const { ids } = f;

const READ_TOOLS = [
  "get_workspace",
  "list_phone_numbers",
  "get_attention_items",
  "list_calls",
  "get_call",
  "get_call_analytics",
  "search_people",
  "get_person",
  "list_agents",
  "get_agent",
  "list_agent_versions",
  "compare_agent_versions",
  "list_knowledge_bases",
  "get_knowledge_base",
  "search_knowledge_base",
  "list_bookings",
  "list_webhook_endpoints",
  "list_webhook_deliveries",
];
const WRITE_TOOLS = [
  "update_person",
  "add_knowledge_source",
  "add_knowledge_answer",
  "cancel_booking",
  "redeliver_webhook",
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(routes: Parameters<typeof connect>[0], options?: Parameters<typeof connect>[1]) {
  const session = await connect(routes, options);
  close = session.close;
  return session;
}

describe("tool registration", () => {
  it("is read-only by default", async () => {
    const { mcp } = await setup({});
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.description?.length, tool.name).toBeGreaterThan(40);
    }
  });

  it("adds annotated write tools with allowWrites", async () => {
    const { mcp } = await setup({}, { allowWrites: true });
    const { tools } = await mcp.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of WRITE_TOOLS) expect(byName.has(name), name).toBe(true);
    expect(byName.get("cancel_booking")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get("update_person")?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(byName.get("add_knowledge_source")?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(byName.get("redeliver_webhook")?.annotations).toMatchObject({ idempotentHint: false });
  });

  it("gives every tool an object input schema", async () => {
    const { mcp } = await setup({}, { allowWrites: true });
    const { tools } = await mcp.listTools();
    for (const tool of tools) expect(tool.inputSchema.type, tool.name).toBe("object");
  });
});

describe("calls", () => {
  it("list_calls maps filters to the API and returns compact rows", async () => {
    const { call, api } = await setup({ "GET /v1/calls": f.callList });
    const result = await call("list_calls", {
      from: "2026-11-18",
      to: "2026-11-19",
      needs_callback: true,
      urgent: true,
      limit: 10,
    });

    expect(result.isError).toBe(false);
    expect(api.requests[0]?.query).toEqual({
      from: "2026-11-18T06:00:00.000Z",
      to: "2026-11-19T06:00:00.000Z",
      unfinished: "any",
      urgency: "high",
      kind: "live",
      limit: "10",
    });
    expect(result.data.count).toBe(2);
    expect(result.data.next_cursor).toBe("cur_page2");
    expect(result.data.calls[0]).toMatchObject({
      id: ids.call,
      caller: "Jordan Rivera",
      outcome: "message_taken",
      also_reached: ["urgent_escalated"],
      urgency: "high",
      reason: "Leaking water heater",
    });
    expect(result.data.calls[1]).not.toHaveProperty("urgency");
    expect(result.data.calls[1]).not.toHaveProperty("person_id");
  });

  it("list_calls includes test calls only when asked", async () => {
    const { call, api } = await setup({ "GET /v1/calls": f.callList });
    await call("list_calls", { include_test_calls: true, cursor: "cur_page2" });
    expect(api.requests[0]?.query).toEqual({ limit: "25", cursor: "cur_page2" });
  });

  it("list_calls explains a bad date instead of calling the API", async () => {
    const { call, api } = await setup({ "GET /v1/calls": f.callList });
    const result = await call("list_calls", { from: "last tuesday" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/from must be a date/);
    expect(api.requests).toHaveLength(0);
  });

  it("get_call returns details and the transcript", async () => {
    const { call } = await setup({ "GET /v1/calls/{id}": f.callDetail });
    const result = await call("get_call", { call_id: ids.call });
    expect(result.data).toMatchObject({
      id: ids.call,
      follow_up_by: "Sam Ortiz",
      review: {
        result: "failed",
        satisfaction: "4/5",
        failed: ["Gave correct hours (fail): Said 8am instead of 7am."],
      },
      tools_used: ["take_message"],
    });
    expect(result.content[1]?.text).toMatch(/^Transcript:\n\[0:00\] Agent: Thanks for calling/);
  });

  it("get_call leaves the transcript out when asked", async () => {
    const { call } = await setup({ "GET /v1/calls/{id}": f.callDetail });
    const result = await call("get_call", { call_id: ids.call, include_transcript: false });
    expect(result.content).toHaveLength(1);
  });

  it("get_call_analytics defaults to the last 7 days and summarizes", async () => {
    const { call, api } = await setup({ "GET /v1/analytics/calls": f.analytics });
    const result = await call("get_call_analytics", { time_zone: "UTC" });
    const { from, to, time_zone } = api.requests[0]?.query ?? {};
    expect(time_zone).toBe("UTC");
    expect(Date.parse(to as string) - Date.parse(from as string)).toBe(7 * 86_400_000);
    expect(result.data).toMatchObject({
      calls: 42,
      booking_rate: 40,
      outcomes: { booked: 14, message_taken: 11 },
      callbacks_waiting: { calls: 4 },
      success_rate: 83.3,
    });
    expect(result.data.busiest_hours[0]).toEqual({ day: 1, hour: 9, calls: 6 });
    expect(result.data).not.toHaveProperty("latency");
  });

  it("rejects an unknown time zone", async () => {
    const { call } = await setup({});
    const result = await call("get_call_analytics", { time_zone: "Mars/Olympus" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Unknown time zone/);
  });
});

describe("people", () => {
  it("search_people sends the query", async () => {
    const { call, api } = await setup({ "GET /v1/people": f.peopleList });
    const result = await call("search_people", { query: "Rivera" });
    expect(api.requests[0]?.query).toEqual({ q: "Rivera", limit: "25" });
    expect(result.data.people[0]).toMatchObject({ id: ids.person, phone: "+15555550100" });
    expect(result.data).not.toHaveProperty("next_cursor");
  });

  it("get_person includes notes and recent conversations", async () => {
    const { call } = await setup({ "GET /v1/people/{id}": f.personDetail });
    const result = await call("get_person", { person_id: ids.person });
    expect(result.data.notes).toBe("Prefers mornings.");
    expect(result.data.recent_conversations[0]).toMatchObject({ call_id: ids.call, outcome: "message_taken" });
  });

  it("update_person with append_note keeps existing notes", async () => {
    const { call, api } = await setup(
      {
        "GET /v1/people/{id}": f.personDetail,
        "PATCH /v1/people/{id}": (req) => ({ ...f.personDetail, ...(req.body as object) }),
      },
      { allowWrites: true },
    );
    const result = await call("update_person", { person_id: ids.person, append_note: "Called back, booked Tuesday." });
    expect(result.isError).toBe(false);
    const patch = api.requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({
      notes: expect.stringMatching(/^Prefers mornings\.\n\d{4}-\d{2}-\d{2}: Called back, booked Tuesday\.$/),
    });
  });

  it("update_person refuses an empty change", async () => {
    const { call, api } = await setup({}, { allowWrites: true });
    const result = await call("update_person", { person_id: ids.person });
    expect(result.isError).toBe(true);
    expect(api.requests).toHaveLength(0);
  });
});

describe("agents", () => {
  it("get_agent shows numbers, live version and booking", async () => {
    const { call } = await setup({ "GET /v1/agents/{id}": f.agentDetail });
    const result = await call("get_agent", { agent_id: ids.agent });
    expect(result.data).toMatchObject({
      name: "Front desk",
      phone_numbers: ["+15555550001"],
      live_version: { number: 3 },
      languages: "English and Spanish",
      booking: { state: "on", calendars: ["Google Calendar"] },
      tools: ["book_appointment"],
      collects: ["Service address (required)"],
    });
  });

  it("compare_agent_versions defaults to the live version and the one before", async () => {
    const { call, api } = await setup({
      "GET /v1/agents/{id}/versions": f.agentVersions,
      "GET /v1/agents/{id}/versions/{a}/diff/{b}": f.versionDiff,
    });
    const result = await call("compare_agent_versions", { agent_id: ids.agent });
    expect(api.requests.at(-1)?.path).toBe(`/v1/agents/${ids.agent}/versions/2/diff/3`);
    expect(result.data.steps[0]).toEqual({
      step: "Greeting",
      type: "conversation",
      change: "changed",
      changes: [{ key: "prompt", before: "We open at 8.", after: "We open at 7." }],
    });
  });

  it("compare_agent_versions explains when there's only one version", async () => {
    const { call } = await setup({
      "GET /v1/agents/{id}/versions": { data: [f.agentVersions.data[0]] },
    });
    const result = await call("compare_agent_versions", { agent_id: ids.agent });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/fewer than two/);
  });
});

describe("knowledge", () => {
  it("search_knowledge_base posts the query", async () => {
    const { call, api } = await setup({ "POST /v1/knowledge-bases/{id}/search": f.knowledgeSearch });
    const result = await call("search_knowledge_base", { knowledge_base_id: ids.kb, query: "water heater price" });
    expect(api.requests[0]?.body).toEqual({ query: "water heater price", limit: 5 });
    expect(result.data.results[0]).toMatchObject({ title: "Pricing › Water heaters", score: 0.877 });
  });

  it("add_knowledge_source builds the body for the kind", async () => {
    const { call, api } = await setup(
      { "POST /v1/knowledge-bases/{id}/sources": jsonResponse(201, f.knowledgeSource) },
      { allowWrites: true },
    );
    const result = await call("add_knowledge_source", {
      knowledge_base_id: ids.kb,
      kind: "qa",
      name: "Hours",
      pairs: [{ question: "When do you open?", answer: "7am on weekdays." }],
      url: "https://example.com/ignored",
    });
    expect(result.isError).toBe(false);
    expect(api.requests[0]?.body).toEqual({
      kind: "qa",
      name: "Hours",
      pairs: [{ question: "When do you open?", answer: "7am on weekdays." }],
    });
    expect(api.requests[0]?.headers["idempotency-key"]).toBeDefined();
  });

  it("add_knowledge_source says what a kind needs", async () => {
    const { call } = await setup({}, { allowWrites: true });
    const result = await call("add_knowledge_source", { knowledge_base_id: ids.kb, kind: "url" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("kind url needs url.");
  });
});

describe("calendar, numbers, attention and webhooks", () => {
  it("list_bookings defaults to a week from now", async () => {
    const { call, api } = await setup({ "GET /v1/calendar/bookings": f.bookings });
    const result = await call("list_bookings");
    const { from, to } = api.requests[0]?.query ?? {};
    const days = (Date.parse(to as string) - Date.parse(from as string)) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(8.1);
    expect(result.data.bookings[0]).toMatchObject({ id: ids.booking, caller: "Jordan Rivera", call_id: ids.call });
  });

  it("list_bookings refuses a range over 42 days", async () => {
    const { call, api } = await setup({});
    const result = await call("list_bookings", { from: "2026-11-01", to: "2027-01-01" });
    expect(result.isError).toBe(true);
    expect(api.requests).toHaveLength(0);
  });

  it("cancel_booking posts the cancel", async () => {
    const { call, api } = await setup(
      { "POST /v1/calendar/bookings/{id}/cancel": { booking: { ...f.booking, status: "cancelled" } } },
      { allowWrites: true },
    );
    const result = await call("cancel_booking", { booking_id: ids.booking });
    expect(api.requests[0]?.path).toBe(`/v1/calendar/bookings/${ids.booking}/cancel`);
    expect(result.data.cancelled).toBe(true);
  });

  it("list_phone_numbers names each number's agent", async () => {
    const { call } = await setup({ "GET /v1/phone-numbers": f.phoneNumbers });
    const result = await call("list_phone_numbers");
    expect(result.data.phone_numbers[0]).toMatchObject({ number: "+15555550001", agent: { name: "Front desk" } });
  });

  it("get_attention_items reports what's broken", async () => {
    const { call } = await setup({ "GET /v1/attention": f.attention });
    const result = await call("get_attention_items");
    expect(result.data.items[0]).toMatchObject({ level: "red: failing now", dashboard_page: "/settings/integrations" });
  });

  it("list_webhook_deliveries can show failures only", async () => {
    const { call } = await setup({ "GET /v1/webhook-endpoints/{id}/deliveries": f.deliveries });
    const result = await call("list_webhook_deliveries", { endpoint_id: ids.endpoint, failed_only: true });
    expect(result.data.count).toBe(1);
    expect(result.data.deliveries[0]).toMatchObject({ status: "failed", response_code: 500 });
  });

  it("get_workspace shows the key's scopes and the time", async () => {
    const { call } = await setup({ "GET /v1/workspace": f.workspace });
    const result = await call("get_workspace");
    expect(result.data).toMatchObject({ name: "Rivera Plumbing", key_scopes: ["calls:read", "people:read"] });
    expect(result.data.time_zone).toBe("America/Chicago");
  });
});

describe("errors", () => {
  it("turns a missing scope into advice", async () => {
    const { call } = await setup({
      "GET /v1/people": jsonResponse(403, {
        error: {
          code: "insufficient_scope",
          message: "API key lacks the 'people:read' scope",
          details: { required: "people:read" },
          request_id: "req_demo",
        },
      }),
    });
    const result = await call("search_people");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("lacks the people:read scope");
    expect(result.text).toContain("Request id: req_demo");
  });

  it("lists validation issues", async () => {
    const { call } = await setup({
      "GET /v1/calls": jsonResponse(400, {
        error: {
          code: "validation_failed",
          message: "Invalid query",
          details: { issues: [{ path: ["reason"], message: "Too long" }] },
        },
      }),
    });
    const result = await call("list_calls");
    expect(result.text).toContain("- reason: Too long");
  });
});

describe("resources and prompts", () => {
  it("lists recent calls and reads a transcript", async () => {
    const { mcp } = await setup({ "GET /v1/calls": f.callList, "GET /v1/calls/{id}": f.callDetail });
    const { resources } = await mcp.listResources();
    expect(resources[0]?.uri).toBe(`ladoo://calls/${ids.call}`);

    const { resourceTemplates } = await mcp.listResourceTemplates();
    expect(resourceTemplates[0]?.uriTemplate).toBe("ladoo://calls/{id}");

    const { contents } = await mcp.readResource({ uri: `ladoo://calls/${ids.call}` });
    const text = (contents[0] as { text: string }).text;
    expect(contents[0]?.mimeType).toBe("text/markdown");
    expect(text).toContain("- **Caller:** Jordan Rivera");
    expect(text).toContain("[0:02] Caller: My water heater is leaking.");
  });

  it("offers three prompts that name real tools", async () => {
    const { mcp } = await setup({}, { allowWrites: true });
    const { prompts } = await mcp.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "daily_call_digest",
      "find_callbacks",
      "missed_bookings_review",
    ]);

    const { tools } = await mcp.listTools();
    const toolNames = new Set(tools.map((t) => t.name));
    for (const prompt of prompts) {
      const { messages } = await mcp.getPrompt({ name: prompt.name, arguments: { time_zone: "UTC" } });
      const text = String((messages[0]?.content as { text?: string } | undefined)?.text);
      const mentioned = text.match(/\b(?:get|list|search|compare)_[a-z_]+/g) ?? [];
      expect(mentioned.length, prompt.name).toBeGreaterThan(0);
      for (const name of mentioned) expect(toolNames.has(name), `${prompt.name} mentions ${name}`).toBe(true);
    }
  });

  it("daily_call_digest uses the date it's given", async () => {
    const { mcp } = await setup({});
    const { messages } = await mcp.getPrompt({
      name: "daily_call_digest",
      arguments: { date: "2026-11-20", time_zone: "America/Chicago" },
    });
    const text = String((messages[0]?.content as { text?: string } | undefined)?.text);
    expect(text).toContain("from 2026-11-20, to 2026-11-21, time_zone America/Chicago");
  });
});

describe("without an API key", () => {
  it("tools explain how to set one", async () => {
    const server = createServer({ client: { apiKey: undefined } });
    const mcp = new Client({ name: "test", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), mcp.connect(a)]);
    close = () => mcp.close();

    const result = await mcp.callTool({ name: "list_agents", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/LADOO_API_KEY is not set/);
    expect((await mcp.listResources()).resources).toEqual([]);
  });
});
