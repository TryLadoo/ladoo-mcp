import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LadooApiError, MissingApiKeyError } from "./client.js";
import type { components } from "./generated/openapi.js";

export type Schemas = components["schemas"];

export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

/**
 * Drops `null`, `undefined`, empty arrays and empty objects, so outputs carry only what is there.
 * Tool outputs go into a model's context window: every key costs tokens.
 */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact).filter((v) => !isEmpty(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const c = compact(v);
      if (!isEmpty(c)) out[key] = c;
    }
    return out as T;
  }
  return value;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function truncate(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** A tool result holding one JSON document (compacted), plus optional extra text blocks. */
export function json(value: unknown, ...extra: string[]): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(compact(value)) },
      ...extra.map((text) => ({ type: "text" as const, text })),
    ],
  };
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error) }] };
}

export function describeError(error: unknown): string {
  if (error instanceof MissingApiKeyError || error instanceof ToolInputError) return error.message;
  if (error instanceof LadooApiError) {
    const lines = [`Ladoo API error ${error.status} ${error.code}: ${error.message}`];
    const hint = hintFor(error);
    if (hint) lines.push(hint);
    if (error.code === "validation_failed" && Array.isArray(error.details?.issues)) {
      for (const issue of error.details.issues as { path?: unknown; message?: unknown }[]) {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "");
        lines.push(`- ${path || "(request)"}: ${String(issue.message ?? "")}`);
      }
    }
    if (error.requestId) lines.push(`Request id: ${error.requestId} (include it if you contact support@tryladoo.com).`);
    return lines.join("\n");
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The Ladoo API didn't answer in time. Try again in a moment.";
  }
  return `Request to the Ladoo API failed: ${error instanceof Error ? error.message : String(error)}`;
}

function hintFor(error: LadooApiError): string | undefined {
  switch (error.code) {
    case "unauthorized":
    case "key_expired":
      return "Check LADOO_API_KEY: it may be mistyped, revoked or expired. Make a new key under Settings → Developers.";
    case "insufficient_scope": {
      const scope = typeof error.details?.required === "string" ? error.details.required : "the needed";
      return `This API key lacks the ${scope} scope. Create a key that has it under Settings → Developers.`;
    }
    case "rate_limited":
      return `Rate limited. Wait ${error.retryAfterSeconds ?? "a few"} seconds before trying again.`;
    case "not_found":
      return "Nothing with that id in this workspace. Ids come from the list and search tools.";
    default:
      return undefined;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * Reads a time argument: an ISO 8601 date-time with an offset, or a bare date (`2026-11-20`),
 * which means midnight at the start of that day in `timeZone`.
 */
export function parseTime(input: string, field: string, timeZone: string): string {
  const value = input.trim();
  if (DATE_ONLY.test(value)) return zonedMidnight(value, timeZone).toISOString();
  if (DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  throw new ToolInputError(
    `${field} must be a date like 2026-11-20 or a date-time with an offset like 2026-11-20T09:00:00-05:00 (got "${input}").`,
  );
}

/** The UTC instant of midnight starting `date` (YYYY-MM-DD) in an IANA time zone. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // The zone's offset can differ between the guess and the answer around a DST change; two passes settle it.
  let instant = guess - offsetMs(guess, timeZone);
  instant = guess - offsetMs(instant, timeZone);
  return new Date(instant);
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const ROLE_LABEL: Record<Schemas["TranscriptEntry"]["role"], string> = {
  agent: "Agent",
  caller: "Caller",
  tool: "Tool",
  staff: "Staff",
};

/** A transcript as plain lines, `[m:ss] Speaker: text`, with English translations and flags inline. */
export function formatTranscript(
  entries: Schemas["TranscriptEntry"][] | null | undefined,
  flags: Schemas["CallFlag"][] | null | undefined = [],
): string {
  if (!entries?.length) return "(no transcript)";
  const flagsByLine = new Map<number, Schemas["CallFlag"][]>();
  for (const flag of flags ?? []) {
    flagsByLine.set(flag.entry_index, [...(flagsByLine.get(flag.entry_index) ?? []), flag]);
  }
  return entries
    .map((entry, index) => {
      const speaker = entry.speaker
        ? `${ROLE_LABEL[entry.role] ?? entry.role} (${entry.speaker})`
        : ROLE_LABEL[entry.role];
      let line = `[${formatOffset(entry.start_ms)}] ${speaker ?? entry.role}: ${entry.text}`;
      if (entry.translation) line += ` [English: ${entry.translation}]`;
      if (entry.interrupted) line += " [interrupted]";
      for (const flag of flagsByLine.get(index) ?? []) {
        line += `\n    FLAGGED ${flag.category} (${flag.severity}): ${flag.issue}`;
      }
      return line;
    })
    .join("\n");
}

type CallListItem = Schemas["CallSummary"] & {
  person?: { id: string; name: string | null } | null;
  success?: "passed" | "failed" | "unclear" | null;
};

/** One call, as a list row: what happened and who called, without the transcript. */
export function callRow(call: CallListItem) {
  return {
    id: call.id,
    started_at: call.started_at,
    duration_seconds: call.duration_seconds,
    channel: call.channel,
    status: call.status === "in_progress" ? "in_progress" : undefined,
    kind: call.kind === "test" ? "test" : undefined,
    from: call.from_number,
    caller: call.person?.name ?? call.extracted?.caller_name ?? null,
    person_id: call.person?.id,
    outcome: call.outcome?.type ?? null,
    also_reached: call.outcome?.reached?.filter((o) => o !== call.outcome?.type),
    urgency: call.urgency === "high" ? "high" : undefined,
    reason: call.extracted?.reason,
    callback_number: call.extracted?.callback_number,
    hung_up_early: call.hung_up_early || undefined,
    success: call.success,
    summary: truncate(call.summary, 280),
  };
}
