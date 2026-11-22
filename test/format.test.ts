import { describe, expect, it } from "vitest";
import { compact, formatTranscript, parseTime, todayIn, truncate, zonedMidnight } from "../src/format.js";
import { callDetail } from "./fixtures.js";

describe("parseTime", () => {
  it("reads a bare date as midnight in the time zone", () => {
    expect(parseTime("2026-11-20", "from", "America/Chicago")).toBe("2026-11-20T06:00:00.000Z");
    expect(parseTime("2026-07-01", "from", "America/Chicago")).toBe("2026-07-01T05:00:00.000Z");
    expect(parseTime("2026-11-20", "from", "UTC")).toBe("2026-11-20T00:00:00.000Z");
  });

  it("keeps a date-time's own offset", () => {
    expect(parseTime("2026-11-20T09:00:00-05:00", "from", "UTC")).toBe("2026-11-20T14:00:00.000Z");
  });

  it("rejects a date-time with no offset, and nonsense", () => {
    expect(() => parseTime("2026-11-20T09:00", "from", "UTC")).toThrow(/offset/);
    expect(() => parseTime("yesterday", "to", "UTC")).toThrow(/to must be/);
  });
});

describe("zonedMidnight", () => {
  it("handles days when the clocks change", () => {
    // US clocks spring forward at 2am on 2026-03-08 and fall back on 2026-11-01; midnight is unaffected.
    expect(zonedMidnight("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedMidnight("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(zonedMidnight("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(zonedMidnight("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("works east of UTC", () => {
    expect(zonedMidnight("2026-11-20", "Asia/Kolkata").toISOString()).toBe("2026-11-19T18:30:00.000Z");
  });
});

describe("todayIn", () => {
  it("uses the zone's calendar day", () => {
    const lateEvening = new Date("2026-11-21T03:00:00Z");
    expect(todayIn("America/Chicago", lateEvening)).toBe("2026-11-20");
    expect(todayIn("UTC", lateEvening)).toBe("2026-11-21");
  });
});

describe("compact", () => {
  it("drops nulls, empty arrays and empty objects, and keeps false and 0", () => {
    expect(compact({ a: null, b: [], c: {}, d: { e: undefined }, f: false, g: 0, h: [null, 1] })).toEqual({
      f: false,
      g: 0,
      h: [1],
    });
  });
});

describe("truncate", () => {
  it("collapses whitespace and cuts long text", () => {
    expect(truncate("a  b\n c", 10)).toBe("a b c");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate(null, 5)).toBeUndefined();
  });
});

describe("formatTranscript", () => {
  it("writes timestamped lines and marks flagged ones", () => {
    const text = formatTranscript(callDetail.transcript, callDetail.flags);
    expect(text.split("\n")[0]).toBe("[0:00] Agent: Thanks for calling Rivera Plumbing, how can I help?");
    expect(text).toContain("[1:04] Agent: We open at 8 tomorrow.\n    FLAGGED incorrect (medium)");
  });

  it("shows translations", () => {
    const text = formatTranscript([{ role: "caller", text: "Hola", translation: "Hello", start_ms: 0, end_ms: 1 }]);
    expect(text).toBe("[0:00] Caller: Hola [English: Hello]");
  });

  it("says when there's no transcript", () => {
    expect(formatTranscript(null)).toBe("(no transcript)");
  });
});
