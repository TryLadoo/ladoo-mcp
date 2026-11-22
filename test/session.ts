import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LadooClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { mockApi, type Reply } from "./mock-api.js";

/** An MCP client connected in memory to a server backed by the fake API. */
export async function connect(routes: Record<string, Reply>, options: { allowWrites?: boolean } = {}) {
  const api = mockApi(routes);
  const client = new LadooClient({ apiKey: "lsk_test_demo", fetch: api.fetch, sleep: async () => {} });
  const server = createServer({ client, allowWrites: options.allowWrites, timeZone: "America/Chicago" });
  const mcp = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await mcp.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    const first = content[0]?.text ?? "";
    let data: any;
    try {
      data = JSON.parse(first);
    } catch {
      data = undefined;
    }
    return { isError: result.isError === true, text: first, data, content };
  }

  return { mcp, api, call, close: () => mcp.close() };
}
