#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isValidTimeZone } from "./format.js";
import { startHttpServer } from "./http.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `ladoo-mcp ${VERSION}: the Ladoo MCP server

Usage: ladoo-mcp [options]

Options:
  --allow-writes   Also register tools that change data (or LADOO_ALLOW_WRITES=1)
  --http           Serve Streamable HTTP at /mcp instead of stdio
  --port <n>       HTTP port (default 3000, or PORT)
  --host <addr>    HTTP address to bind (default 127.0.0.1)
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  LADOO_API_KEY       Your API key (Settings → Developers in Ladoo)
  LADOO_TIME_ZONE     IANA time zone for dates like "2026-11-20" (default: the system's)
  LADOO_ALLOW_WRITES  1 to register write tools
  LADOO_BASE_URL      API base URL (default https://api.tryladoo.com)

Docs: https://github.com/TryLadoo/ladoo-mcp`;

const { values } = parseArgs({
  options: {
    "allow-writes": { type: "boolean", default: false },
    http: { type: "boolean", default: false },
    port: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}

const env = process.env;
const apiKey = env.LADOO_API_KEY?.trim() || undefined;
const allowWrites =
  values["allow-writes"] || ["1", "true", "yes"].includes((env.LADOO_ALLOW_WRITES ?? "").toLowerCase());
const baseUrl = env.LADOO_BASE_URL || undefined;
let timeZone = env.LADOO_TIME_ZONE || undefined;
if (timeZone && !isValidTimeZone(timeZone)) {
  console.error(`ladoo-mcp: ignoring LADOO_TIME_ZONE="${timeZone}": not an IANA time zone.`);
  timeZone = undefined;
}

// stdout carries the MCP protocol in stdio mode, so everything for people goes to stderr.
if (values.http) {
  const port = Number(values.port ?? env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`ladoo-mcp: invalid port "${values.port ?? env.PORT}".`);
    process.exit(2);
  }
  await startHttpServer({ host: values.host, port, apiKey, baseUrl, allowWrites, timeZone });
  console.error(
    `ladoo-mcp ${VERSION} listening on http://${values.host}:${port}/mcp (${allowWrites ? "read and write" : "read-only"})`,
  );
} else {
  if (!apiKey) {
    console.error("ladoo-mcp: LADOO_API_KEY is not set. Tools will answer with an error until it is.");
  }
  const server = createServer({ client: { apiKey, baseUrl }, allowWrites, timeZone });
  await server.connect(new StdioServerTransport());
}
