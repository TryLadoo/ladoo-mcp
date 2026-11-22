import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addDays,
  callRow,
  formatTranscript,
  isValidTimeZone,
  json,
  parseTime,
  type Schemas,
  ToolInputError,
  todayIn,
  truncate,
} from "../format.js";
import { cursor, handle, id, page, readOnly, type ToolContext, timeArg, timeZoneArg } from "./shared.js";

const OUTCOMES = [
  "booked",
  "message_taken",
  "urgent_escalated",
  "transferred",
  "info_provided",
  "no_action",
  "spam",
  "blocked",
  "cap_reached",
] as const;

const yesNo = (value: boolean | undefined) => (value === undefined ? undefined : value ? "true" : "false");

export function resolveTimeZone(ctx: ToolContext, timeZone: string | undefined): string {
  if (!timeZone) return ctx.timeZone;
  if (!isValidTimeZone(timeZone))
    throw new ToolInputError(`Unknown time zone "${timeZone}". Use an IANA name like America/New_York.`);
  return timeZone;
}

export function registerCallTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_calls",
    {
      title: "List calls",
      description:
        "List or search phone calls and website chats, newest first. Each row has the outcome, the caller, the reason and a short summary; use get_call with an id for the transcript. " +
        "Filters combine. For 'who do I need to call back' use needs_callback; for urgent ones use urgent. Test calls are left out unless include_test_calls is true.",
      inputSchema: {
        from: timeArg("Only calls that started at or after this").optional(),
        to: timeArg("Only calls that started before this").optional(),
        time_zone: timeZoneArg,
        outcome: z.enum(OUTCOMES).optional().describe("Only calls that ended with this outcome"),
        needs_callback: z
          .boolean()
          .optional()
          .describe("Only calls where the caller hung up partway through a booking or a message: people to call back"),
        unfinished: z
          .enum(["booking", "message", "any"])
          .optional()
          .describe(
            "Narrower than needs_callback: only calls abandoned partway through a booking, a message, or either",
          ),
        urgent: z.boolean().optional().describe("true: only calls the agent marked urgent"),
        agent_id: z.string().uuid().optional().describe("Only calls handled by this agent"),
        phone_number_id: z.string().uuid().optional().describe("Only calls to this Ladoo number"),
        channel: z.enum(["phone", "web_chat"]).optional(),
        caller_phone: z.string().optional().describe("Only calls from this phone number, in any format"),
        reason: z.string().min(1).max(500).optional().describe("Only calls with exactly this reason (ignoring case)"),
        flagged: z.boolean().optional().describe("Only calls the post-call review flagged a line in"),
        calendar_error: z
          .boolean()
          .optional()
          .describe("Only calls where the booking calendar or CRM couldn't be reached"),
        after_hours: z.boolean().optional().describe("Only calls outside (true) or inside (false) business hours"),
        first_call: z.boolean().optional().describe("Only first-time callers (true), or only returning ones (false)"),
        include_test_calls: z
          .boolean()
          .optional()
          .describe("Include test calls made from the dashboard. Default false."),
        limit: z.number().int().min(1).max(100).optional().describe("Rows per page, 1-100. Default 25."),
        cursor,
      },
      annotations: readOnly("List calls"),
    },
    handle(async (args) => {
      const tz = resolveTimeZone(ctx, args.time_zone);
      const result = await ctx.client.get("/v1/calls", {
        query: {
          from: args.from ? parseTime(args.from, "from", tz) : undefined,
          to: args.to ? parseTime(args.to, "to", tz) : undefined,
          outcome: args.outcome,
          unfinished: args.unfinished ?? (args.needs_callback ? "any" : undefined),
          urgency: args.urgent ? "high" : undefined,
          agent_id: args.agent_id,
          phone_number_id: args.phone_number_id,
          channel: args.channel,
          caller_phone: args.caller_phone,
          reason: args.reason,
          flagged: yesNo(args.flagged),
          calendar_error: yesNo(args.calendar_error),
          after_hours: yesNo(args.after_hours),
          first_call: yesNo(args.first_call),
          kind: args.include_test_calls ? undefined : "live",
          limit: args.limit ?? 25,
          cursor: args.cursor,
        },
      });
      return json({ calls: result.data.map(callRow), count: result.data.length, ...page(result.next_cursor) });
    }),
  );

  server.registerTool(
    "get_call",
    {
      title: "Get a call",
      description:
        "One call or chat in full: summary, outcome, what the caller said they needed, who follows up, how it scored against the agent's success criteria, and the transcript with timestamps.",
      inputSchema: {
        call_id: id("call"),
        include_transcript: z.boolean().optional().describe("Include the transcript. Default true."),
      },
      annotations: readOnly("Get a call"),
    },
    handle(async ({ call_id, include_transcript }) => {
      const call = await ctx.client.get("/v1/calls/{id}", { path: { id: call_id } });
      const details = callDetails(call);
      if (include_transcript === false) return json(details);
      return json(details, `Transcript:\n${formatTranscript(call.transcript, call.flags)}`);
    }),
  );

  server.registerTool(
    "get_call_analytics",
    {
      title: "Call analytics",
      description:
        "Totals for live phone calls in a date range: calls, minutes, outcomes, booking rate, callbacks waiting, urgent and flagged calls, new vs returning callers, top reasons, calls per day, and the same figures for the period before. Defaults to the last 7 days.",
      inputSchema: {
        from: timeArg("Start of the range (inclusive)").optional(),
        to: timeArg("End of the range (exclusive)").optional(),
        time_zone: timeZoneArg,
        agent_id: z.string().uuid().optional().describe("Only this agent's calls"),
        phone_number_id: z.string().uuid().optional().describe("Only calls to this number"),
      },
      annotations: readOnly("Call analytics"),
    },
    handle(async (args) => {
      const tz = resolveTimeZone(ctx, args.time_zone);
      const today = todayIn(tz);
      const from = parseTime(args.from ?? addDays(today, -6), "from", tz);
      const to = parseTime(args.to ?? addDays(today, 1), "to", tz);
      const a = await ctx.client.get("/v1/analytics/calls", {
        query: { from, to, time_zone: tz, agent_id: args.agent_id, phone_number_id: args.phone_number_id },
      });
      return json(analyticsSummary(a));
    }),
  );
}

type CallDetail = Schemas["CallSummary"] & {
  transcript?: Schemas["TranscriptEntry"][] | null;
  flags?: Schemas["CallFlag"][] | null;
  guardrail_breaches?: Schemas["GuardrailBreach"][] | null;
  tool_calls?: Schemas["ToolCall"][] | null;
  person?: { id: string; name: string | null } | null;
  judgment?: Schemas["CallJudgment"] | null;
  follow_up?: { user_id: string; name: string } | null;
  text_back?: { status: string; reason: string | null } | null;
  crm_sync?: { status: string; error: string | null } | null;
  booking_notices?: Schemas["BookingNotice"][];
};

export function callDetails(call: CallDetail) {
  return {
    ...callRow(call),
    summary: call.summary,
    to: call.to_number,
    ended_at: call.ended_at,
    end_reason: call.end_reason,
    language: call.language === "en" ? undefined : call.language,
    agent_version_id: call.workflow_version_id,
    follow_up_by: call.follow_up?.name,
    text_back: call.text_back ? [call.text_back.status, call.text_back.reason].filter(Boolean).join(": ") : undefined,
    crm_sync: call.crm_sync ? [call.crm_sync.status, call.crm_sync.error].filter(Boolean).join(": ") : undefined,
    review:
      call.judgment && call.judgment.status === "judged"
        ? {
            result: call.judgment.outcome,
            satisfaction: call.judgment.csat ? `${call.judgment.csat}/5` : undefined,
            failed: call.judgment.results
              .filter((r) => r.verdict !== "pass")
              .map((r) => `${r.criterion} (${r.verdict}): ${r.reason}`),
          }
        : undefined,
    guardrail_breaches: call.guardrail_breaches?.map((b) => `${b.rule}: "${truncate(b.quote, 200)}"`),
    tools_used: call.tool_calls?.map((t) =>
      t.ok ? t.name : `${t.name} (failed${t.error_kind ? `: ${t.error_kind}` : ""})`,
    ),
    booking_notices: call.booking_notices?.map(
      (n) => `${n.kind} by ${n.channel}: ${n.status}${n.reason ? ` (${n.reason})` : ""}`,
    ),
  };
}

function analyticsSummary(a: Schemas["CallAnalytics"]) {
  return {
    range: a.range,
    calls: a.calls,
    minutes: a.minutes,
    average_seconds: a.average_seconds,
    conversations: a.conversations,
    booking_rate: a.booking_rate === null ? null : Math.round(a.booking_rate * 1000) / 10,
    booking_rate_unit: "percent",
    outcomes: Object.fromEntries(a.outcomes.map((o) => [o.outcome ?? "none", o.calls])),
    callbacks_waiting: a.callbacks_waiting,
    urgent: a.urgent,
    flagged: a.flagged,
    calendar_errors: a.calendar_errors,
    hung_up_early: a.hung_up_early,
    after_hours: a.after_hours,
    business_hours: a.business_hours,
    callers: a.callers,
    success_rate: a.judging.success_rate === null ? null : Math.round(a.judging.success_rate * 1000) / 10,
    csat_average: a.judging.csat_average,
    top_reasons: a.reasons.slice(0, 10),
    busiest_hours: [...a.busiest].sort((x, y) => y.calls - x.calls).slice(0, 3),
    daily: a.daily,
    previous_period: a.previous,
  };
}
