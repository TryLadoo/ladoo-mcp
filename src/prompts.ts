import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays, isValidTimeZone, todayIn } from "./format.js";

const tzArg = z.string().optional().describe("IANA time zone, e.g. America/Chicago");

function user(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer, defaultTimeZone: string) {
  const zone = (tz: string | undefined) => (tz && isValidTimeZone(tz) ? tz : defaultTimeZone);

  server.registerPrompt(
    "daily_call_digest",
    {
      title: "Daily call digest",
      description: "A short digest of one day's calls: what came in, what got booked, and who needs a call back.",
      argsSchema: { date: z.string().optional().describe("The day, YYYY-MM-DD. Default today."), time_zone: tzArg },
    },
    ({ date, time_zone }) => {
      const tz = zone(time_zone);
      const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIn(tz);
      return user(
        `Write a digest of my Ladoo calls on ${day} (time zone ${tz}).

1. Call get_call_analytics with from ${day}, to ${addDays(day, 1)}, time_zone ${tz} for the totals.
2. Call list_calls with the same range and time zone, following next_cursor until done.
3. Call get_attention_items to check nothing is broken.

Then write, in this order and briefly:
- One line with the totals: calls, bookings, messages taken, and how that compares with the day before.
- Who needs a call back: urgent calls, messages taken, and calls abandoned partway through a booking or message. For each, the caller, their number, the reason, and the call id.
- Appointments booked, one line each.
- Anything that needs fixing, from get_attention_items. Leave this out if nothing does.
Skip spam and blocked calls. Don't invent details that aren't in the data.`,
      );
    },
  );

  server.registerPrompt(
    "find_callbacks",
    {
      title: "Find calls that need a callback",
      description: "Every recent caller who is waiting to hear back, most urgent first.",
      argsSchema: { days: z.string().optional().describe("How many days back to look. Default 2."), time_zone: tzArg },
    },
    ({ days, time_zone }) => {
      const tz = zone(time_zone);
      const n = Math.min(Math.max(Number.parseInt(days ?? "2", 10) || 2, 1), 31);
      const from = addDays(todayIn(tz), -(n - 1));
      return user(
        `Find every caller from ${from} onward (time zone ${tz}) who is waiting for a call back from my business.

Use list_calls with from ${from} and time_zone ${tz}, three times:
- urgent: true
- outcome: message_taken
- needs_callback: true (callers who hung up partway through a booking or message)

Follow next_cursor on each. Merge the results, one row per caller (use person_id or the phone number to spot the same person twice), and drop anyone who later booked or was transferred, per list_calls.
If a reason is unclear, open the call with get_call.

Reply with a table, most urgent first: caller, callback number, what they need, when they called, call id.`,
      );
    },
  );

  server.registerPrompt(
    "missed_bookings_review",
    {
      title: "Review missed bookings",
      description: "Calls in the last week that should have become appointments but didn't, and why.",
      argsSchema: { days: z.string().optional().describe("How many days back to look. Default 7."), time_zone: tzArg },
    },
    ({ days, time_zone }) => {
      const tz = zone(time_zone);
      const n = Math.min(Math.max(Number.parseInt(days ?? "7", 10) || 7, 1), 31);
      const from = addDays(todayIn(tz), -(n - 1));
      return user(
        `Review the bookings my Ladoo agent missed from ${from} onward (time zone ${tz}).

1. list_calls with from ${from}, time_zone ${tz} and unfinished: booking: callers who hung up partway through booking.
2. list_calls with from ${from}, time_zone ${tz} and calendar_error: true: bookings that failed because a calendar or CRM couldn't be reached.
3. get_call_analytics for the same range, for the booking rate and how it compares with the period before.
4. For up to 5 of the calls from steps 1 and 2, get_call and read the transcript to see where the booking fell apart.

Summarize: how many bookings were missed, the common reasons (quote the transcript briefly), who to call back to rebook (name, number, call id), and one or two concrete changes to the agent or the calendar setup that would have saved them.`,
      );
    },
  );
}
