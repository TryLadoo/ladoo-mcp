import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LadooClient, type LadooClientOptions } from "./client.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerCallTools } from "./tools/calls.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { VERSION } from "./version.js";

export { LadooApiError, LadooClient } from "./client.js";
export { VERSION } from "./version.js";

export interface ServerOptions {
  /** A ready client, or options to make one. */
  client: LadooClient | LadooClientOptions;
  /** Register the tools that change data. Default false. */
  allowWrites?: boolean;
  /** IANA time zone that bare dates in tool arguments are read in. Default: the system's. */
  timeZone?: string;
}

const INSTRUCTIONS = `Tools for a Ladoo workspace. Ladoo is an AI receptionist that answers a business's phone and website chat, books appointments and takes messages.
List and search tools return short rows with ids; get_* tools return one item in full. Lists are paginated: pass next_cursor back as cursor.
Dates can be bare (2026-11-20, read in the workspace time zone) or ISO 8601 with an offset. get_workspace tells you the current time and what the API key can do.
Before any tool that changes data, tell the user exactly what will change and get their confirmation.`;

export function createServer(options: ServerOptions): McpServer {
  const client = options.client instanceof LadooClient ? options.client : new LadooClient(options.client);
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const allowWrites = options.allowWrites ?? false;
  const ctx = { client, timeZone };

  const server = new McpServer(
    { name: "ladoo", title: "Ladoo", version: VERSION, websiteUrl: "https://tryladoo.com/docs/developers" },
    { instructions: INSTRUCTIONS },
  );

  registerWorkspaceTools(server, ctx);
  registerCallTools(server, ctx);
  registerPeopleTools(server, ctx, allowWrites);
  registerAgentTools(server, ctx);
  registerKnowledgeTools(server, ctx, allowWrites);
  registerCalendarTools(server, ctx, allowWrites);
  registerWebhookTools(server, ctx, allowWrites);
  registerResources(server, client);
  registerPrompts(server, timeZone);
  return server;
}
