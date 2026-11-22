import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type Schemas, truncate } from "../format.js";
import { handle, id, readOnly, type ToolContext, write } from "./shared.js";

function deliveryRow(d: Schemas["WebhookDelivery"]) {
  return {
    id: d.id,
    event_type: d.event_type,
    event_id: d.event_id,
    status: d.status,
    test: d.test || undefined,
    attempts: d.attempts,
    response_code: d.response_code,
    error: d.error,
    response_body: d.status === "delivered" ? undefined : truncate(d.response_body, 300),
    created_at: d.created_at,
    next_attempt_at: d.next_attempt_at,
  };
}

export function registerWebhookTools(server: McpServer, ctx: ToolContext, allowWrites: boolean) {
  server.registerTool(
    "list_webhook_endpoints",
    {
      title: "List webhook endpoints",
      description:
        "The workspace's webhook endpoints, the events each receives, and whether deliveries to it are failing or it was paused for failing.",
      inputSchema: {},
      annotations: readOnly("List webhook endpoints"),
    },
    handle(async () => {
      const { data } = await ctx.client.get("/v1/webhook-endpoints");
      return json({
        endpoints: data.map((e) => ({
          id: e.id,
          url: e.url,
          description: e.description,
          events: e.events,
          enabled: e.enabled,
          failing_since: e.failing_since,
          paused_for_failing_at: e.auto_disabled_at,
        })),
      });
    }),
  );

  server.registerTool(
    "list_webhook_deliveries",
    {
      title: "List webhook deliveries",
      description:
        "An endpoint's recent deliveries, newest first, with the receiver's response code and error for each. Use it to see why an integration missed events.",
      inputSchema: {
        endpoint_id: id("webhook endpoint"),
        failed_only: z.boolean().optional().describe("Only deliveries that failed"),
        limit: z.number().int().min(1).max(100).optional().describe("Deliveries to look at, 1-100. Default 25."),
      },
      annotations: readOnly("List webhook deliveries"),
    },
    handle(async ({ endpoint_id, failed_only, limit }) => {
      const { data } = await ctx.client.get("/v1/webhook-endpoints/{id}/deliveries", {
        path: { id: endpoint_id },
        query: { limit: limit ?? 25 },
      });
      const rows = failed_only ? data.filter((d) => d.status === "failed") : data;
      return json({ deliveries: rows.map(deliveryRow), count: rows.length });
    }),
  );

  if (!allowWrites) return;

  server.registerTool(
    "redeliver_webhook",
    {
      title: "Redeliver a webhook",
      description:
        "Send a delivered or failed webhook delivery to its endpoint again, with the same event id and a fresh set of retries. The receiving system will act on it again unless it dedupes by event id.",
      inputSchema: { delivery_id: id("delivery") },
      annotations: write("Redeliver a webhook", { destructive: false, idempotent: false, openWorld: true }),
    },
    handle(async ({ delivery_id }) => {
      const delivery = await ctx.client.post("/v1/webhook-deliveries/{id}/redeliver", { path: { id: delivery_id } });
      return json({ queued: true, delivery: deliveryRow(delivery) });
    }),
  );
}
