import { describe, expect, it } from "bun:test";
import {
  extractTitle,
  formatAmPm,
  formatTagsYaml,
  getDatePartsFor,
  getJournalPathForDate,
  getProjectName,
  mergeTags,
  padCounter,
  parsePlanFrontmatter,
  shortSessionId,
  stripTitleLine,
  toSlug,
} from "../shared.ts";

// ---- extractTitle ----

describe("extractTitle", () => {
  it("extracts a simple markdown heading", () => {
    expect(extractTitle("# My Plan")).toBe("My Plan");
  });

  it("strips plan: prefix (case insensitive)", () => {
    expect(extractTitle("# Plan: My Plan")).toBe("My Plan");
    expect(extractTitle("# plan: lowercase")).toBe("lowercase");
    expect(extractTitle("PLAN: Upper")).toBe("Upper");
  });

  it("skips leading blank lines", () => {
    expect(extractTitle("\n\n# Title")).toBe("Title");
  });

  it("strips backticks", () => {
    expect(extractTitle("# `refactor` auth")).toBe("refactor auth");
  });

  it("strips bold and italic markers", () => {
    expect(extractTitle("# **Bold** _Title_")).toBe("Bold Title");
  });

  it("handles multiple heading levels", () => {
    expect(extractTitle("## Sub Title")).toBe("Sub Title");
    expect(extractTitle("### Deep Title")).toBe("Deep Title");
  });

  it("returns plain text when no heading", () => {
    expect(extractTitle("Just a line")).toBe("Just a line");
  });

  it("returns 'Unnamed Plan' for empty string", () => {
    expect(extractTitle("")).toBe("Unnamed Plan");
  });

  it("returns 'Unnamed Plan' for whitespace-only", () => {
    expect(extractTitle("  \n  \n  ")).toBe("Unnamed Plan");
  });

  it("returns 'Unnamed Plan' for hash-only lines", () => {
    expect(extractTitle("###")).toBe("Unnamed Plan");
  });

  it("collapses multiple spaces", () => {
    expect(extractTitle("#  Too   Many   Spaces")).toBe("Too Many Spaces");
  });

  it("uses first non-empty line", () => {
    expect(extractTitle("# First\n# Second")).toBe("First");
  });
});

// ---- toSlug ----

describe("toSlug", () => {
  it("converts a simple title", () => {
    expect(toSlug("My Plan")).toBe("my-plan");
  });

  it("replaces ampersand with 'and'", () => {
    expect(toSlug("Auth & Login")).toBe("auth-and-login");
  });

  it("strips special characters", () => {
    expect(toSlug("Plan: v2.0!")).toBe("plan-v20");
  });

  it("collapses multiple spaces and dashes", () => {
    expect(toSlug("too  many---dashes")).toBe("too-many-dashes");
  });

  it("removes leading and trailing dashes", () => {
    expect(toSlug("-lead-trail-")).toBe("lead-trail");
  });

  it("truncates at 80 chars on word boundary", () => {
    // Each word is 5 chars + dash = ~6 chars per word. 14 words ≈ 83 chars
    const longTitle = "alpha bravo delta gamma theta sigma omega kappa lambd zetta mu nu xi rho";
    const slug = toSlug(longTitle);
    expect(slug.length).toBeLessThanOrEqual(80);
    // Should not end with a dash
    expect(slug).not.toMatch(/-$/);
  });

  it("returns 'unnamed-plan' for empty string", () => {
    expect(toSlug("")).toBe("unnamed-plan");
  });

  it("returns 'unnamed-plan' for only special chars", () => {
    expect(toSlug("!@#$%")).toBe("unnamed-plan");
  });

  it("does not truncate a slug under 80 chars", () => {
    const title = "Short Title";
    expect(toSlug(title)).toBe("short-title");
  });

  it("handles multiple ampersands", () => {
    expect(toSlug("A & B & C")).toBe("a-and-b-and-c");
  });
});

// ---- stripTitleLine ----

describe("stripTitleLine", () => {
  it("strips heading and returns body", () => {
    expect(stripTitleLine("# Title\n\nBody text")).toBe("Body text");
  });

  it("strips leading blanks after title", () => {
    expect(stripTitleLine("# Title\n\n\nBody")).toBe("Body");
  });

  it("returns original when no title-like line found", () => {
    const input = "\n\n\n";
    expect(stripTitleLine(input)).toBe(input);
  });

  it("strips plan: prefix title", () => {
    expect(stripTitleLine("Plan: Title\nBody")).toBe("Body");
  });

  it("preserves multiple lines after title", () => {
    expect(stripTitleLine("# T\n\nL1\nL2")).toBe("L1\nL2");
  });

  it("handles content with no body after title", () => {
    expect(stripTitleLine("# Just a title")).toBe("");
  });

  it("handles title with formatting markers", () => {
    expect(stripTitleLine("## **Bold Title**\n\nBody")).toBe("Body");
  });
});

// ---- formatAmPm ----

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

// ---- mergeTags ----

describe("mergeTags", () => {
  it("merges with no overlap", () => {
    expect(mergeTags(["a"], "b,c")).toBe("a,b,c");
  });

  it("deduplicates overlapping tags", () => {
    expect(mergeTags(["a", "b"], "b,c")).toBe("a,b,c");
  });

  it("handles empty existing array", () => {
    expect(mergeTags([], "x,y")).toBe("x,y");
  });

  it("handles empty new CSV", () => {
    expect(mergeTags(["a"], "")).toBe("a");
  });

  it("handles both empty", () => {
    expect(mergeTags([], "")).toBe("");
  });

  it("trims whitespace", () => {
    expect(mergeTags([" a "], " b , c ")).toBe("a,b,c");
  });

  it("returns existing when all new are duplicates", () => {
    expect(mergeTags(["a", "b"], "a,b")).toBe("a,b");
  });

  it("preserves order: existing first, then new", () => {
    expect(mergeTags(["z", "a"], "m,b")).toBe("z,a,m,b");
  });
});

// ---- padCounter ----

describe("padCounter", () => {
  it("pads single digit", () => {
    expect(padCounter(1)).toBe("001");
  });

  it("pads double digit", () => {
    expect(padCounter(42)).toBe("042");
  });

  it("keeps triple digit as-is", () => {
    expect(padCounter(100)).toBe("100");
  });

  it("does not truncate four digits", () => {
    expect(padCounter(1000)).toBe("1000");
  });

  it("pads zero", () => {
    expect(padCounter(0)).toBe("000");
  });
});

// ---- parsePlanFrontmatter ----

describe("parsePlanFrontmatter", () => {
  it("parses new-format frontmatter (topical tags, project, session link)", () => {
    const content = `---
created: "[[Journal/2026/03-March/29-Sunday|2026-03-29T14:30]]"
project: capture-plan
tags:
  - plugin-dev
  - hooks
session: "[[Sessions/3a76e3ac]]"
---
# My Plan

Body text`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.created).toBe("[[Journal/2026/03-March/29-Sunday|2026-03-29T14:30]]");
    expect(fm.journalPath).toBe("Journal/2026/03-March/29-Sunday");
    expect(fm.datetime).toBe("2026-03-29T14:30");
    expect(fm.project).toBe("capture-plan");
    expect(fm.tags).toEqual(["plugin-dev", "hooks"]);
    expect(fm.session).toBe('"[[Sessions/3a76e3ac]]"');
  });

  it("parses legacy frontmatter (status, counter, source)", () => {
    const content = `---
created: "[[Journal/2026/03-March/29-Sunday|2026-03-29T14:30]]"
status: planned
tags:
  - plan
  - claude-session
source: Claude Code (Plan Mode)
session: abc123
counter: 1
---
# My Plan

Body text`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.created).toBe("[[Journal/2026/03-March/29-Sunday|2026-03-29T14:30]]");
    expect(fm.status).toBe("planned");
    expect(fm.tags).toEqual(["plan", "claude-session"]);
    expect(fm.session).toBe("abc123");
    expect(fm.counter).toBe(1);
  });

  it("returns empty object when no frontmatter", () => {
    const fm = parsePlanFrontmatter("# Just a heading\n\nSome text");
    expect(fm).toEqual({});
  });

  it("handles frontmatter without created field", () => {
    const content = `---
status: planned
counter: 5
---
# Plan`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.created).toBeUndefined();
    expect(fm.journalPath).toBeUndefined();
    expect(fm.datetime).toBeUndefined();
    expect(fm.status).toBe("planned");
    expect(fm.counter).toBe(5);
  });

  it("handles frontmatter without tags", () => {
    const content = `---
status: done
---
# Plan`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.tags).toBeUndefined();
    expect(fm.status).toBe("done");
  });

  it("handles created field without quotes", () => {
    const content = `---
created: [[Journal/2026/01-January/15-Wednesday|2026-01-15T09:00]]
---
# Plan`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.journalPath).toBe("Journal/2026/01-January/15-Wednesday");
    expect(fm.datetime).toBe("2026-01-15T09:00");
  });

  it("parses project field", () => {
    const content = `---
project: my-app
---
# Plan`;

    const fm = parsePlanFrontmatter(content);
    expect(fm.project).toBe("my-app");
  });

  it("handles empty content", () => {
    expect(parsePlanFrontmatter("")).toEqual({});
  });

  it("handles malformed frontmatter (no closing ---)", () => {
    const content = `---
status: planned
# No closing delimiter`;

    expect(parsePlanFrontmatter(content)).toEqual({});
  });
});

// ---- getProjectName ----

describe("getProjectName", () => {
  it("extracts basename from cwd", () => {
    expect(getProjectName("/Users/k/src/github/kriswill/capture-plan")).toBe("capture-plan");
  });

  it("returns empty string for undefined", () => {
    expect(getProjectName(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(getProjectName("")).toBe("");
  });

  it("handles root path", () => {
    expect(getProjectName("/")).toBe("");
  });
});

// ---- formatTagsYaml ----

describe("formatTagsYaml", () => {
  it("formats comma-separated tags as YAML list", () => {
    expect(formatTagsYaml("plugin-dev, hooks")).toBe("  - plugin-dev\n  - hooks");
  });

  it("handles single tag", () => {
    expect(formatTagsYaml("refactoring")).toBe("  - refactoring");
  });

  it("returns empty string for empty input", () => {
    expect(formatTagsYaml("")).toBe("");
  });

  it("trims whitespace from tags", () => {
    expect(formatTagsYaml("  foo ,  bar  ")).toBe("  - foo\n  - bar");
  });
});

// ---- shortSessionId ----

describe("shortSessionId", () => {
  it("returns first 8 characters", () => {
    expect(shortSessionId("3a76e3ac-3e0b-44c4-8962-b02716a8138b")).toBe("3a76e3ac");
  });

  it("returns full string if shorter than 8", () => {
    expect(shortSessionId("abc")).toBe("abc");
  });
});

// ---- getDatePartsFor ----

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

// ---- getJournalPathForDate ----

describe("getJournalPathForDate", () => {
  const config = { plan_path: "Claude/Plans", journal_path: "Journal" };

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

  it("uses custom journal_path from config", () => {
    const customConfig = { plan_path: "Claude/Plans", journal_path: "MyJournal" };
    const date = new Date(2026, 2, 29, 14, 30);
    expect(getJournalPathForDate(customConfig, date)).toBe("MyJournal/2026/03-March/29-Sunday");
  });
});
