import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer } from "../src/http.js";
import { workspace } from "./fixtures.js";

let fakeApi: Server;
let mcpServer: Server;
let mcpUrl: URL;
const seenKeys: string[] = [];

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );

beforeAll(async () => {
  fakeApi = createServer((req, res) => {
    seenKeys.push(req.headers.authorization ?? "");
    if (req.url === "/v1/workspace")
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(workspace));
    else res.writeHead(404).end();
  });
  const apiPort = await listen(fakeApi);
  mcpServer = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    apiKey: undefined,
    baseUrl: `http://127.0.0.1:${apiPort}`,
    timeZone: "UTC",
  });
  mcpUrl = new URL(`http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`);
});

afterAll(async () => {
  await new Promise((r) => mcpServer.close(r));
  await new Promise((r) => fakeApi.close(r));
});

describe("Streamable HTTP", () => {
  it("passes the request's bearer key through to the Ladoo API", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, {
        requestInit: { headers: { Authorization: "Bearer lsk_http_demo" } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.some((t) => t.name === "get_workspace")).toBe(true);
    expect(tools.some((t) => t.name === "cancel_booking")).toBe(false);

    const result = await client.callTool({ name: "get_workspace", arguments: {} });
    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).name).toBe("Rivera Plumbing");
    expect(seenKeys.at(-1)).toBe("Bearer lsk_http_demo");
    await client.close();
  });

  it("answers 401 without a key", async () => {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("serves a health check", async () => {
    const res = await fetch(new URL("/healthz", mcpUrl));
    expect(await res.text()).toBe("ok");
  });
});
