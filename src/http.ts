import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type ServerOptions } from "./server.js";

export interface HttpOptions extends Omit<ServerOptions, "client"> {
  host: string;
  port: number;
  /** Used when a request has no `Authorization: Bearer` header of its own. */
  apiKey: string | undefined;
  baseUrl?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Serves MCP over Streamable HTTP at `/mcp`, statelessly: every request gets a fresh server.
 * A request's own `Authorization: Bearer lsk_…` header wins over the configured key, so one
 * deployment can serve several workspaces without holding their keys.
 */
export function startHttpServer(options: HttpOptions): Promise<Server> {
  // On a loopback address, only accept loopback Host headers, so a web page can't reach the server via DNS rebinding.
  let allowedHosts: string[] | undefined;

  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found. The MCP endpoint is /mcp.");
      return;
    }

    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const apiKey = bearer ?? options.apiKey;
    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Send a Ladoo API key as Authorization: Bearer lsk_…" },
          id: null,
        }),
      );
      return;
    }

    const server = createServer({
      client: { apiKey, baseUrl: options.baseUrl },
      allowWrites: options.allowWrites,
      timeZone: options.timeZone,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: allowedHosts !== undefined,
      allowedHosts,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("ladoo-mcp: request failed:", error);
      if (!res.headersSent) {
        res
          .writeHead(500, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => {
      const { port } = http.address() as AddressInfo;
      if (LOOPBACK.has(options.host)) allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      resolve(http);
    });
  });
}
