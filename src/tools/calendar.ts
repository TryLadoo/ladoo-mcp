import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addDays, json, parseTime, type Schemas, ToolInputError, todayIn } from "../format.js";
import { resolveTimeZone } from "./calls.js";
import { handle, readOnly, type ToolContext, timeArg, timeZoneArg, write } from "./shared.js";

const MAX_RANGE_DAYS = 42;

function bookingRow(b: Schemas["CalendarBooking"]) {
  return {
    id: b.id,
    start: b.start,
    end: b.end,
    caller: b.person_name ?? b.caller_name,
    caller_phone: b.caller_phone,
    reason: b.reason,
    title: b.title,
    status: b.status === "booked" ? undefined : b.status,
    calendars: b.calendars,
    agent: b.agent_name,
    call_id: b.call_id,
    cancellable: b.cancellable,
    problems: b.events.filter((e) => e.state === "failed").map((e) => `${e.label}: ${e.error ?? "failed"}`),
    cancel_summary: b.summary,
  };
}

export function registerCalendarTools(server: McpServer, ctx: ToolContext, allowWrites: boolean) {
  server.registerTool(
    "list_bookings",
    {
      title: "List bookings",
      description:
        "Appointments Ladoo's agents booked, oldest first, with the caller, reason and the call that booked them. Defaults to the next 7 days from now. A range can be at most 42 days.",
      inputSchema: {
        from: timeArg("Start of the range").optional(),
        to: timeArg("End of the range (exclusive)").optional(),
        time_zone: timeZoneArg,
        include_cancelled: z.boolean().optional().describe("Also list cancelled appointments. Default false."),
      },
      annotations: readOnly("List bookings"),
    },
    handle(async (args) => {
      const tz = resolveTimeZone(ctx, args.time_zone);
      const from = args.from ? parseTime(args.from, "from", tz) : new Date().toISOString();
      const to = args.to ? parseTime(args.to, "to", tz) : parseTime(addDays(todayIn(tz), 8), "to", tz);
      if (Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) {
        throw new ToolInputError(`The range can be at most ${MAX_RANGE_DAYS} days. Ask for a shorter one.`);
      }
      const result = await ctx.client.get("/v1/calendar/bookings", {
        query: { from, to, include_cancelled: args.include_cancelled ? "true" : undefined },
      });
      return json({
        time_zone: result.timezone,
        range: { from, to },
        bookings: result.bookings.map(bookingRow),
        count: result.bookings.length,
      });
    }),
  );

  if (!allowWrites) return;

  server.registerTool(
    "cancel_booking",
    {
      title: "Cancel a booking",
      description:
        "Cancel an appointment Ladoo booked: removes the event Ladoo created from every calendar it wrote to and keeps the booking as cancelled. Callers are not called. This can't be undone, so confirm the appointment with the user first.",
      inputSchema: { booking_id: z.string().min(1).describe("The booking's id, from list_bookings") },
      annotations: write("Cancel a booking", { destructive: true, idempotent: true }),
    },
    handle(async ({ booking_id }) => {
      const { booking } = await ctx.client.post("/v1/calendar/bookings/{id}/cancel", { path: { id: booking_id } });
      return json({ cancelled: booking.status === "cancelled", booking: bookingRow(booking) });
    }),
  );
}
