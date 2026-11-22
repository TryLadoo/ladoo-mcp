import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { json, type Schemas, ToolInputError, truncate } from "../format.js";
import { handle, id, readOnly, type ToolContext, write } from "./shared.js";

function baseRow(kb: Schemas["KnowledgeBase"]) {
  return {
    id: kb.id,
    name: kb.name,
    description: truncate(kb.description, 200),
    status: kb.status,
    sources: kb.source_count,
    documents: kb.document_count,
    used_by_agents: kb.agents.map((a) => a.name),
    updated_at: kb.updated_at,
  };
}

function sourceRow(s: Schemas["KnowledgeSource"]) {
  const config = s.config as { url?: string; filename?: string; from_calls?: boolean };
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    url: config.url,
    file: config.filename,
    fixes_from_calls: config.from_calls || undefined,
    status: s.status,
    error: s.error,
    failed_pages: s.failures.length || undefined,
    documents: s.document_count,
    summary: truncate(s.summary, 200),
    updated_at: s.updated_at,
  };
}

export function registerKnowledgeTools(server: McpServer, ctx: ToolContext, allowWrites: boolean) {
  server.registerTool(
    "list_knowledge_bases",
    {
      title: "List knowledge bases",
      description:
        "The workspace's knowledge bases: the business information agents answer from, which agents use each, and whether it's ready.",
      inputSchema: {},
      annotations: readOnly("List knowledge bases"),
    },
    handle(async () => {
      const { data } = await ctx.client.get("/v1/knowledge-bases");
      return json({ knowledge_bases: data.map(baseRow) });
    }),
  );

  server.registerTool(
    "get_knowledge_base",
    {
      title: "Get a knowledge base",
      description:
        "One knowledge base and its sources (pasted text, Q&A, web pages, websites and files), with each source's status.",
      inputSchema: { knowledge_base_id: id("knowledge base") },
      annotations: readOnly("Get a knowledge base"),
    },
    handle(async ({ knowledge_base_id }) => {
      const kb = await ctx.client.get("/v1/knowledge-bases/{id}", { path: { id: knowledge_base_id } });
      return json({ ...baseRow(kb), sources: kb.sources.map(sourceRow) });
    }),
  );

  server.registerTool(
    "search_knowledge_base",
    {
      title: "Search a knowledge base",
      description:
        "Search a knowledge base the way an agent does on a call, and get the passages it would answer from. Use it to check what an agent knows about a topic before adding to it.",
      inputSchema: {
        knowledge_base_id: id("knowledge base"),
        query: z.string().min(1).max(1000).describe("A question or topic, as a caller would put it"),
        limit: z.number().int().min(1).max(10).optional().describe("Passages to return, 1-10. Default 5."),
      },
      annotations: readOnly("Search a knowledge base"),
    },
    handle(async ({ knowledge_base_id, query, limit }) => {
      const result = await ctx.client.post("/v1/knowledge-bases/{id}/search", {
        path: { id: knowledge_base_id },
        body: { query, limit: limit ?? 5 },
      });
      return json({
        match: result.mode,
        results: result.results.map((r) => ({
          title: [r.title, ...r.heading_path].filter(Boolean).join(" › "),
          source_id: r.source_id,
          url: r.uri,
          score: Math.round(r.score * 1000) / 1000,
          text: truncate(r.text, 900),
        })),
      });
    }),
  );

  if (!allowWrites) return;

  server.registerTool(
    "add_knowledge_source",
    {
      title: "Add a knowledge source",
      description:
        "Add information to a knowledge base: pasted text (kind text), question-and-answer pairs (kind qa), one web page (kind url) or a website crawl (kind website). The source is indexed in the background; agents use it once its status is ready. Each call adds a new source, so don't repeat it. Confirm with the user first.",
      inputSchema: {
        knowledge_base_id: id("knowledge base"),
        kind: z.enum(["text", "qa", "url", "website"]),
        name: z.string().min(1).max(200).optional().describe("A name for the source, shown in Ladoo"),
        text: z.string().min(1).optional().describe("kind text: the text to add"),
        pairs: z
          .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
          .min(1)
          .optional()
          .describe("kind qa: the questions and answers"),
        url: z.string().url().optional().describe("kind url or website: the page, or the site to start crawling from"),
        max_pages: z.number().int().min(1).max(1000).optional().describe("kind website: most pages to crawl"),
      },
      annotations: write("Add a knowledge source", { destructive: false, idempotent: false, openWorld: true }),
    },
    handle(async ({ knowledge_base_id, kind, name, text, pairs, url, max_pages }) => {
      let body: Schemas["CreateKnowledgeSourceRequest"];
      if (kind === "text") {
        if (!text) throw new ToolInputError("kind text needs text.");
        body = { kind, name, text };
      } else if (kind === "qa") {
        if (!pairs) throw new ToolInputError("kind qa needs pairs.");
        body = { kind, name, pairs };
      } else {
        if (!url) throw new ToolInputError(`kind ${kind} needs url.`);
        body = kind === "url" ? { kind, name, url } : { kind, name, url, max_pages };
      }
      const source = await ctx.client.post("/v1/knowledge-bases/{id}/sources", {
        path: { id: knowledge_base_id },
        body,
      });
      return json({ added: true, source: sourceRow(source) });
    }),
  );

  server.registerTool(
    "add_knowledge_answer",
    {
      title: "Add an FAQ answer",
      description:
        "Teach a knowledge base one question and its answer, such as a fix for something an agent got wrong on a call. It goes into the base's 'Fixes from calls' Q&A source; asking the same question again replaces the answer. Confirm with the user first.",
      inputSchema: {
        knowledge_base_id: id("knowledge base"),
        question: z.string().min(1).max(1000).describe("What callers ask, as the agent should recognize it"),
        answer: z.string().min(1).max(5000).describe("What the agent should say or know"),
      },
      annotations: write("Add an FAQ answer", { destructive: false, idempotent: true }),
    },
    handle(async ({ knowledge_base_id, question, answer }) => {
      const source = await ctx.client.post("/v1/knowledge-bases/{id}/answers", {
        path: { id: knowledge_base_id },
        body: { question, answer },
      });
      return json({ added: true, source: sourceRow(source) });
    }),
  );
}
