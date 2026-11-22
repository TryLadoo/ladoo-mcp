import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { json } from "../format.js";
import { handle, readOnly, type ToolContext } from "./shared.js";

export function registerWorkspaceTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_workspace",
    {
      title: "Get the workspace",
      description:
        "The Ladoo workspace this API key belongs to, the scopes the key has, and the current time. Call it first if unsure what this key can do or what 'today' is.",
      inputSchema: {},
      annotations: readOnly("Get the workspace"),
    },
    handle(async () => {
      const w = await ctx.client.get("/v1/workspace");
      return json({
        id: w.id,
        name: w.name,
        kind: w.kind,
        agency: w.parent?.name,
        key_scopes: w.viewer.scopes,
        settings: {
          recognize_returning_callers: w.recognize_callers,
          callers_can_change_bookings: w.caller_booking_changes,
          missed_call_text_back: w.text_back,
        },
        now: new Date().toISOString(),
        time_zone: ctx.timeZone,
      });
    }),
  );

  server.registerTool(
    "list_phone_numbers",
    {
      title: "List phone numbers",
      description: "The workspace's Ladoo phone numbers and the agent that answers each one.",
      inputSchema: {},
      annotations: readOnly("List phone numbers"),
    },
    handle(async () => {
      const { data } = await ctx.client.get("/v1/phone-numbers");
      return json({
        phone_numbers: data.map((n) => ({
          id: n.id,
          number: n.e164,
          type: n.type,
          locality: n.locality,
          status: n.status,
          agent: n.agent ? { id: n.agent.id, name: n.agent.name } : "No agent: calls to it aren't answered",
        })),
      });
    }),
  );

  server.registerTool(
    "get_attention_items",
    {
      title: "Things that need attention",
      description:
        "Problems that are stopping calls or bookings from working, such as a disconnected calendar or a number that isn't routing, most serious first. For an agency, includes its client workspaces. An empty list means nothing is broken.",
      inputSchema: {},
      annotations: readOnly("Things that need attention"),
    },
    handle(async () => {
      const { data } = await ctx.client.get("/v1/attention");
      return json({
        items: data.map((i) => ({
          level: i.level === "red" ? "red: failing now" : "amber: fix soon",
          kind: i.kind,
          message: i.message,
          workspace: i.workspace?.name,
          dashboard_page: i.path,
          since: i.opened_at,
        })),
        all_clear: data.length === 0 || undefined,
      });
    }),
  );
}
