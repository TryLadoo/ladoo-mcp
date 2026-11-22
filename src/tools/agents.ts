import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type Schemas, ToolInputError, truncate } from "../format.js";
import { handle, id, readOnly, type ToolContext } from "./shared.js";

const version = (what: string) => z.number().int().min(1).describe(`${what} version number`);

function languages(agent: Schemas["Agent"]) {
  return agent.defaults.languages === "en_es" ? "English and Spanish" : agent.defaults.language;
}

function preview(value: unknown, max = 400): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return truncate(value, max);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return truncate(JSON.stringify(value), max);
}

function keyChanges(changes: Schemas["WorkflowVersionKeyChange"][], max = 400) {
  return changes.map((c) => ({ key: c.key, before: preview(c.before, max), after: preview(c.after, max) }));
}

export function registerAgentTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description:
        "The workspace's agents (the AI receptionists that answer calls and chats), with their greeting and languages. Use get_agent for its phone numbers, live workflow version and booking setup.",
      inputSchema: {},
      annotations: readOnly("List agents"),
    },
    handle(async () => {
      const { data } = await ctx.client.get("/v1/agents");
      return json({
        agents: data.map((a) => ({
          id: a.id,
          name: a.name,
          languages: languages(a),
          greeting: truncate(a.defaults.first_message, 200),
          updated_at: a.updated_at,
        })),
      });
    }),
  );

  server.registerTool(
    "get_agent",
    {
      title: "Get an agent",
      description:
        "One agent: the phone numbers it answers, the workflow version that's live, where it books appointments, its tools, the details it collects from callers, its success criteria, and recent versions.",
      inputSchema: {
        agent_id: id("agent"),
        include_instructions: z
          .boolean()
          .optional()
          .describe("Include the agent's full instructions (system prompt). Default false: a short preview."),
      },
      annotations: readOnly("Get an agent"),
    },
    handle(async ({ agent_id, include_instructions }) => {
      const a = await ctx.client.get("/v1/agents/{id}", { path: { id: agent_id } });
      return json({
        id: a.id,
        name: a.name,
        phone_numbers: a.phone_numbers.map((n) => n.e164),
        phone_number_ids: a.phone_numbers.map((n) => n.id),
        live_version: a.workflow
          ? {
              number: a.workflow.version_number,
              version_id: a.workflow.version_id,
              published_at: a.workflow.published_at,
            }
          : "Never published",
        languages: languages(a),
        greeting: a.defaults.first_message,
        greeting_known_caller: a.defaults.first_message_known_caller,
        instructions: include_instructions ? a.defaults.system_prompt : truncate(a.defaults.system_prompt, 500),
        booking: a.workflow?.booking
          ? {
              state: a.workflow.booking.state,
              calendars: a.workflow.booking.calendars,
              notice: a.workflow.booking.notice,
            }
          : undefined,
        tools: a.workflow?.tools.map((t) => t.name),
        collects: a.workflow?.fields.map((f) => `${f.label} (${f.collect})`),
        success_criteria: a.success_criteria,
        pre_call_webhook: a.pre_call_webhook?.url,
        model: `${a.defaults.llm.provider}/${a.defaults.llm.model}`,
        voice: `${a.defaults.tts.provider}/${a.defaults.tts.voice_id}`,
        max_call_seconds: a.defaults.max_call_seconds,
        recent_versions: a.versions.slice(0, 5).map((v) => ({
          number: v.version_number,
          published_at: v.published_at,
          changelog: truncate(v.changelog, 160),
        })),
      });
    }),
  );

  server.registerTool(
    "list_agent_versions",
    {
      title: "List agent versions",
      description:
        "An agent's published workflow versions, newest first, with each one's changelog and which one is live. Compare two with compare_agent_versions.",
      inputSchema: { agent_id: id("agent") },
      annotations: readOnly("List agent versions"),
    },
    handle(async ({ agent_id }) => {
      const { data } = await ctx.client.get("/v1/agents/{id}/versions", { path: { id: agent_id } });
      return json({
        versions: data.map((v) => ({
          number: v.version_number,
          live: v.live || undefined,
          published_at: v.published_at,
          published_by: v.created_by ?? "API key",
          changelog: v.changelog,
        })),
      });
    }),
  );

  server.registerTool(
    "compare_agent_versions",
    {
      title: "Compare agent versions",
      description:
        "What changed between two published versions of an agent: steps added, removed and changed (with the changed text), the call flow, and settings such as fields, tools and calendars. With no versions given, compares the live version with the one before it.",
      inputSchema: {
        agent_id: id("agent"),
        from_version: version("Older").optional(),
        to_version: version("Newer").optional(),
      },
      annotations: readOnly("Compare agent versions"),
    },
    handle(async ({ agent_id, from_version, to_version }) => {
      let a = from_version;
      let b = to_version;
      if (a === undefined || b === undefined) {
        const { data } = await ctx.client.get("/v1/agents/{id}/versions", { path: { id: agent_id } });
        const numbers = data.map((v) => v.version_number).sort((x, y) => y - x);
        b ??= data.find((v) => v.live)?.version_number ?? numbers[0];
        a ??= numbers.find((n) => b !== undefined && n < b);
        if (a === undefined || b === undefined) {
          throw new ToolInputError("This agent has fewer than two published versions, so there's nothing to compare.");
        }
      }
      const diff = await ctx.client.get("/v1/agents/{id}/versions/{a}/diff/{b}", {
        path: { id: agent_id, a, b },
      });
      return json({
        from: {
          number: diff.from.version_number,
          published_at: diff.from.published_at,
          changelog: diff.from.changelog,
        },
        to: { number: diff.to.version_number, published_at: diff.to.published_at, changelog: diff.to.changelog },
        steps: diff.steps.map((s) => ({
          step: s.name ?? s.id,
          type: s.type,
          change: s.change,
          changes: s.change === "changed" ? keyChanges(s.changes, 600) : undefined,
        })),
        flow: keyChanges(diff.flow),
        settings: keyChanges(diff.settings),
        unchanged:
          diff.steps.length + diff.flow.length + diff.settings.length === 0
            ? "No differences between these versions."
            : undefined,
      });
    }),
  );
}
