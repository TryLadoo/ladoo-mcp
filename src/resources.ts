import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LadooClient } from "./client.js";
import { formatTranscript } from "./format.js";
import { callDetails } from "./tools/calls.js";

export function registerResources(server: McpServer, client: LadooClient) {
  server.registerResource(
    "call",
    new ResourceTemplate("ladoo://calls/{id}", {
      list: async () => {
        if (!client.hasApiKey) return { resources: [] };
        const { data } = await client.get("/v1/calls", { query: { kind: "live", limit: 20 } });
        return {
          resources: data.map((call) => ({
            uri: `ladoo://calls/${call.id}`,
            name: `${call.extracted?.caller_name ?? call.from_number ?? "Unknown caller"}, ${call.started_at.slice(0, 16).replace("T", " ")} UTC`,
            description: call.summary ?? undefined,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Call transcript",
      description: "A call or chat with its summary, outcome and full transcript, as Markdown.",
      mimeType: "text/markdown",
    },
    async (uri, { id }) => {
      const callId = Array.isArray(id) ? id[0] : id;
      if (!callId) throw new Error("The URI needs a call id: ladoo://calls/{id}");
      const call = await client.get("/v1/calls/{id}", { path: { id: callId } });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: callMarkdown(call) }] };
    },
  );
}

type Call = Parameters<typeof callDetails>[0];

export function callMarkdown(call: Call): string {
  const d = callDetails(call);
  const facts: [string, string | number | null | undefined][] = [
    ["Started", d.started_at],
    ["Duration", d.duration_seconds != null ? `${d.duration_seconds}s` : undefined],
    ["Channel", d.channel],
    ["From", d.from],
    ["Caller", d.caller],
    ["Outcome", d.outcome],
    ["Reason", d.reason],
    ["Urgency", d.urgency],
    ["Follow-up by", d.follow_up_by],
  ];
  return [
    `# Call ${call.id}`,
    "",
    ...facts.filter(([, v]) => v != null).map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "## Summary",
    "",
    call.summary ?? "(no summary)",
    "",
    "## Transcript",
    "",
    "```text",
    formatTranscript(call.transcript, call.flags),
    "```",
    "",
  ].join("\n");
}
