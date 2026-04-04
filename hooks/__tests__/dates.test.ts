import { describe, expect, it } from "bun:test";
import {
  detectDateScheme,
  formatAmPm,
  formatDatePath,
  formatDuration,
  getDatePartsFor,
  getJournalPathForDate,
  getPlanDatePath,
} from "../shared.ts";

describe("formatAmPm", () => {
  it("formats midnight as 12:00 AM", () => {
    expect(formatAmPm(0, 0)).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatAmPm(12, 0)).toBe("12:00 PM");
  });

  it("formats morning time", () => {
    expect(formatAmPm(9, 5)).toBe("9:05 AM");
  });

  it("formats afternoon time", () => {
    expect(formatAmPm(13, 30)).toBe("1:30 PM");
  });

  it("formats late night", () => {
    expect(formatAmPm(23, 59)).toBe("11:59 PM");
  });

  it("formats 12:01 AM edge case", () => {
    expect(formatAmPm(0, 1)).toBe("12:01 AM");
  });

  it("pads single-digit minutes", () => {
    expect(formatAmPm(14, 3)).toBe("2:03 PM");
  });
});

describe("getDatePartsFor", () => {
  it("returns correct parts for a known date", () => {
    // March 29, 2026 is a Sunday
    const date = new Date(2026, 2, 29, 14, 30);
    const parts = getDatePartsFor(date);
    expect(parts.dd).toBe("29");
    expect(parts.mm).toBe("03");
    expect(parts.yyyy).toBe("2026");
    expect(parts.monthName).toBe("March");
    expect(parts.dayName).toBe("Sunday");
    expect(parts.dateKey).toBe("2026-03-29");
    expect(parts.datetime).toBe("2026-03-29T14:30");
    expect(parts.timeStr).toBe("14:30");
    expect(parts.ampmTime).toBe("2:30 PM");
  });

  it("pads single-digit day and month", () => {
    const date = new Date(2026, 0, 5, 9, 3); // Jan 5
    const parts = getDatePartsFor(date);
    expect(parts.dd).toBe("05");
    expect(parts.mm).toBe("01");
    expect(parts.hh).toBe("09");
    expect(parts.min).toBe("03");
  });

  it("handles midnight", () => {
    const date = new Date(2026, 5, 15, 0, 0);
    const parts = getDatePartsFor(date);
    expect(parts.ampmTime).toBe("12:00 AM");
  });
});

describe("getJournalPathForDate", () => {
  const config = {
    plan: { path: "Claude/Plans", date_scheme: "calendar" as const },
    journal: { path: "Journal", date_scheme: "calendar" as const },
  };

  it("builds correct path for a known date", () => {
    // March 29, 2026 is a Sunday
    const date = new Date(2026, 2, 29, 14, 30);
    expect(getJournalPathForDate(config, date)).toBe("Journal/2026/03-March/29-Sunday");
  });

  it("builds correct path for January 1", () => {
    // Jan 1, 2026 is a Thursday
    const date = new Date(2026, 0, 1, 12, 0);
    expect(getJournalPathForDate(config, date)).toBe("Journal/2026/01-January/01-Thursday");
  });

  it("uses custom journal path from config", () => {
    const customConfig = {
      plan: { path: "Claude/Plans", date_scheme: "calendar" as const },
      journal: { path: "MyJournal", date_scheme: "calendar" as const },
    };
    const date = new Date(2026, 2, 29, 14, 30);
    expect(getJournalPathForDate(customConfig, date)).toBe("MyJournal/2026/03-March/29-Sunday");
  });
});

describe("formatDatePath", () => {
  const date = new Date(2026, 3, 3, 14, 30); // April 3, 2026 is a Friday
  const parts = getDatePartsFor(date);

  it("formats calendar scheme", () => {
    expect(formatDatePath("calendar", parts)).toBe("2026/04-April/03-Friday");
  });

  it("formats compact scheme", () => {
    expect(formatDatePath("compact", parts)).toBe("2026/04-03");
  });

  it("formats monthly scheme", () => {
    expect(formatDatePath("monthly", parts)).toBe("2026/04-April/03");
  });

  it("formats flat scheme", () => {
    expect(formatDatePath("flat", parts)).toBe("2026-04-03");
  });

  it("pads single-digit months and days", () => {
    const jan1 = getDatePartsFor(new Date(2026, 0, 5, 12, 0)); // Jan 5
    expect(formatDatePath("compact", jan1)).toBe("2026/01-05");
    expect(formatDatePath("calendar", jan1)).toBe("2026/01-January/05-Monday");
  });
});

describe("detectDateScheme", () => {
  it("detects calendar scheme", () => {
    expect(detectDateScheme("2026/04-April/03-Friday")).toBe("calendar");
  });

  it("detects compact scheme", () => {
    expect(detectDateScheme("2026/04-03")).toBe("compact");
  });

  it("detects monthly scheme", () => {
    expect(detectDateScheme("2026/04-April/03")).toBe("monthly");
  });

  it("detects flat scheme", () => {
    expect(detectDateScheme("2026-04-03")).toBe("flat");
  });

  it("returns undefined for unrecognized patterns", () => {
    expect(detectDateScheme("random/path")).toBeUndefined();
    expect(detectDateScheme("")).toBeUndefined();
  });
});

describe("getPlanDatePath", () => {
  it("combines plan path with formatted date using configured scheme", () => {
    const config = {
      plan: { path: "Claude/Plans", date_scheme: "calendar" as const },
      journal: { path: "Journal", date_scheme: "calendar" as const },
    };
    const parts = getDatePartsFor(new Date(2026, 3, 3, 14, 30));
    expect(getPlanDatePath(config, parts)).toBe("Claude/Plans/2026/04-April/03-Friday");
  });

  it("uses compact scheme when configured", () => {
    const config = {
      plan: { path: "Plans", date_scheme: "compact" as const },
      journal: { path: "Journal", date_scheme: "calendar" as const },
    };
    const parts = getDatePartsFor(new Date(2026, 3, 3, 14, 30));
    expect(getPlanDatePath(config, parts)).toBe("Plans/2026/04-03");
  });
});

describe("getJournalPathForDate with different schemes", () => {
  it("uses compact scheme for journal", () => {
    const config = {
      plan: { path: "Claude/Plans", date_scheme: "calendar" as const },
      journal: { path: "Journal", date_scheme: "compact" as const },
    };
    const date = new Date(2026, 2, 29, 14, 30);
    expect(getJournalPathForDate(config, date)).toBe("Journal/2026/03-29");
  });

  it("uses flat scheme for journal", () => {
    const config = {
      plan: { path: "Claude/Plans", date_scheme: "calendar" as const },
      journal: { path: "Journal", date_scheme: "flat" as const },
    };
    const date = new Date(2026, 2, 29, 14, 30);
    expect(getJournalPathForDate(config, date)).toBe("Journal/2026-03-29");
  });
});

describe("formatDuration", () => {
  it("formats zero as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats sub-second as 0s", () => {
    expect(formatDuration(999)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats exact minutes without seconds", () => {
    expect(formatDuration(300_000)).toBe("5m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });

  it("formats exact hours", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
  });

  it("formats 1m 13s like CLI output", () => {
    expect(formatDuration(73_000)).toBe("1m 13s");
  });
});
