import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LadooClient } from "../client.js";
import { errorResult } from "../format.js";

export interface ToolContext {
  client: LadooClient;
  /** IANA time zone that bare dates in arguments are read in. */
  timeZone: string;
}

export function readOnly(title: string): ToolAnnotations {
  return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

export function write(
  title: string,
  hints: { destructive: boolean; idempotent: boolean; openWorld?: boolean },
): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: hints.destructive,
    idempotentHint: hints.idempotent,
    openWorldHint: hints.openWorld ?? false,
  };
}

/** Runs a tool body and turns any failure into an `isError` result the model can read and act on. */
export function handle<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

export const id = (what: string) => z.string().uuid().describe(`The ${what}'s id`);

export const cursor = z
  .string()
  .optional()
  .describe("`next_cursor` from the previous page of this same list. Leave out for the first page.");

export const timeArg = (what: string) =>
  z
    .string()
    .describe(
      `${what}: a date (2026-11-20, meaning midnight in the workspace time zone) or an ISO 8601 date-time with an offset`,
    );

export const timeZoneArg = z
  .string()
  .optional()
  .describe("IANA time zone for bare dates, e.g. America/Chicago. Defaults to the server's configured time zone.");

/** Next-page hint, so the model knows the list continues. */
export function page(nextCursor: string | null | undefined) {
  return nextCursor ? { next_cursor: nextCursor, more: "Pass next_cursor as cursor for the next page." } : {};
}
