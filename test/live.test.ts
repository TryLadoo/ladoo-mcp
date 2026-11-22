// Runs against the real API only when LADOO_API_KEY is set locally. CI never sets it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const apiKey = process.env.LADOO_API_KEY;

describe.skipIf(!apiKey)("live API (read-only)", () => {
  it("reads the workspace and the latest call", async () => {
    const server = createServer({ client: { apiKey, baseUrl: process.env.LADOO_BASE_URL } });
    const client = new Client({ name: "live-test", version: "0.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);

    for (const [name, args] of [
      ["get_workspace", {}],
      ["list_calls", { limit: 1 }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    }
    await client.close();
  });
});
