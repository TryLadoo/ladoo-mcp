import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Response } from "../client.js";
import { json, type Schemas, ToolInputError, truncate } from "../format.js";
import { cursor, handle, id, page, readOnly, type ToolContext, write } from "./shared.js";

function personRow(p: Schemas["Person"]) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    conversations: p.conversations,
    first_contact_at: p.first_contact_at,
    last_contact_at: p.last_contact_at,
    channels: p.channels,
    possible_duplicates: p.possible_matches || undefined,
  };
}

type PersonDetail = Response<"/v1/people/{id}", "get">;

function personDetail(p: PersonDetail, historyLimit = 10) {
  return {
    ...personRow(p),
    notes: p.notes,
    other_phones: p.other_phones,
    other_emails: p.other_emails,
    crm_contact: p.crm_contact?.url ?? p.crm_contact?.name,
    recent_conversations: p.history.slice(0, historyLimit).map((h) => ({
      call_id: h.id,
      started_at: h.started_at,
      channel: h.channel,
      outcome: h.outcome,
      summary: truncate(h.summary, 200),
    })),
    more_conversations: p.history.length > historyLimit ? p.history.length - historyLimit : undefined,
    looks_like: p.matches.map((m) => ({
      person_id: m.person.id,
      name: m.person.name,
      phone: m.person.phone,
      strong: m.strong,
      because: m.reasons.map((r) => r.kind),
    })),
  };
}

export function registerPeopleTools(server: McpServer, ctx: ToolContext, allowWrites: boolean) {
  server.registerTool(
    "search_people",
    {
      title: "Search people",
      description:
        "Find callers and chat visitors in People by name, phone or email, most recently in touch first. With no query, lists everyone. Use get_person for notes and conversation history.",
      inputSchema: {
        query: z.string().optional().describe("Name, phone number or email, or part of one"),
        possible_duplicates: z
          .boolean()
          .optional()
          .describe("Only people flagged as a possible duplicate of someone else"),
        limit: z.number().int().min(1).max(100).optional().describe("Rows per page, 1-100. Default 25."),
        cursor,
      },
      annotations: readOnly("Search people"),
    },
    handle(async (args) => {
      const result = await ctx.client.get("/v1/people", {
        query: {
          q: args.query || undefined,
          possible_match: args.possible_duplicates ? "true" : undefined,
          limit: args.limit ?? 25,
          cursor: args.cursor,
        },
      });
      return json({ people: result.data.map(personRow), count: result.data.length, ...page(result.next_cursor) });
    }),
  );

  server.registerTool(
    "get_person",
    {
      title: "Get a person",
      description:
        "One person in full: contact details, the team's notes, their recent calls and chats (with call ids for get_call), and people who look like the same person.",
      inputSchema: { person_id: id("person") },
      annotations: readOnly("Get a person"),
    },
    handle(async ({ person_id }) => {
      const person = await ctx.client.get("/v1/people/{id}", { path: { id: person_id } });
      return json(personDetail(person));
    }),
  );

  if (!allowWrites) return;

  server.registerTool(
    "update_person",
    {
      title: "Edit a person",
      description:
        "Change a person's name, phone, email or notes, or add a note. `notes` replaces all notes; `append_note` adds a dated line to the end and keeps what is there. An edited name sticks: later calls don't overwrite it. Confirm the change with the user first.",
      inputSchema: {
        person_id: id("person"),
        name: z.string().min(1).max(200).optional(),
        phone: z.string().optional().describe("Phone number; stored as E.164"),
        email: z.string().email().optional(),
        notes: z.string().max(10_000).optional().describe("Replaces all of the person's notes"),
        append_note: z.string().min(1).max(2_000).optional().describe("A note to add after the existing notes"),
      },
      annotations: write("Edit a person", { destructive: true, idempotent: false }),
    },
    handle(async ({ person_id, append_note, ...fields }) => {
      if (append_note !== undefined && fields.notes !== undefined) {
        throw new ToolInputError("Send either notes (to replace them) or append_note (to add one), not both.");
      }
      const body: Schemas["PersonUpdate"] = { ...fields };
      if (append_note !== undefined) {
        const current = await ctx.client.get("/v1/people/{id}", { path: { id: person_id } });
        const stamp = new Date().toISOString().slice(0, 10);
        const existing = current.notes?.trimEnd();
        body.notes = `${existing ? `${existing}\n` : ""}${stamp}: ${append_note.trim()}`;
      }
      if (Object.values(body).every((v) => v === undefined)) {
        throw new ToolInputError("Nothing to change: send at least one of name, phone, email, notes or append_note.");
      }
      const person = await ctx.client.patch("/v1/people/{id}", { path: { id: person_id }, body });
      return json({ updated: true, person: personDetail(person, 3) });
    }),
  );
}
