import { describe, expect, it } from "bun:test";
import {
  aggregateSidechainStats,
  computeContextPct,
  contextCapLabel,
  escapeTableCell,
  extractTitle,
  formatAmPm,
  formatCcVersionYaml,
  formatDuration,
  formatModelYaml,
  formatNumber,
  formatStatsYaml,
  formatTagsYaml,
  formatToolArgs,
  formatToolsLogContent,
  formatToolsNoteContent,
  formatToolTable,
  getDatePartsFor,
  getJournalPathForDate,
  getProjectName,
  isCodeLike,
  langFromPath,
  mergeTags,
  mergeTranscriptStats,
  padCounter,
  parsePlanFrontmatter,
  resolveContextCap,
  shortSessionId,
  stripTitleLine,
  toSlug,
} from "../shared.ts";
import type { ToolLog, TranscriptStats, TurnLogEntry } from "../transcript.ts";

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

// ---- formatDuration ----

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

// ---- formatNumber ----

describe("formatNumber", () => {
  it("formats small numbers without commas", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("formats thousands with commas", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("formats large numbers with commas", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

// ---- contextCapLabel ----

describe("contextCapLabel", () => {
  it("formats 200K", () => {
    expect(contextCapLabel(200_000)).toBe("200K");
  });

  it("formats 1M", () => {
    expect(contextCapLabel(1_000_000)).toBe("1M");
  });

  it("formats 2M", () => {
    expect(contextCapLabel(2_000_000)).toBe("2M");
  });

  it("formats 500K", () => {
    expect(contextCapLabel(500_000)).toBe("500K");
  });

  it("rounds to nearest K", () => {
    expect(contextCapLabel(128_000)).toBe("128K");
  });
});

// ---- resolveContextCap ----

describe("resolveContextCap", () => {
  it("returns config value when provided", () => {
    expect(resolveContextCap(50000, 1_000_000)).toBe(1_000_000);
  });

  it("auto-detects 1M when peak > 200K", () => {
    expect(resolveContextCap(250_000)).toBe(1_000_000);
  });

  it("defaults to 200K when peak is within standard range", () => {
    expect(resolveContextCap(100_000)).toBe(200_000);
  });

  it("config takes priority over auto-detect", () => {
    expect(resolveContextCap(250_000, 500_000)).toBe(500_000);
  });
});

// ---- computeContextPct ----

describe("computeContextPct", () => {
  it("computes percentage from input + output", () => {
    const tokens = { input: 50_000, output: 10_000, cache_read: 0, cache_create: 0 };
    expect(computeContextPct(tokens, 200_000)).toBe(30);
  });

  it("rounds to nearest integer", () => {
    const tokens = { input: 33_333, output: 0, cache_read: 0, cache_create: 0 };
    expect(computeContextPct(tokens, 200_000)).toBe(17);
  });

  it("returns 0 when cap is 0", () => {
    const tokens = { input: 50_000, output: 10_000, cache_read: 0, cache_create: 0 };
    expect(computeContextPct(tokens, 0)).toBe(0);
  });

  it("handles large context windows", () => {
    const tokens = { input: 100_000, output: 50_000, cache_read: 0, cache_create: 0 };
    expect(computeContextPct(tokens, 1_000_000)).toBe(15);
  });
});

// ---- formatStatsYaml ----

describe("formatStatsYaml", () => {
  const baseStats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 300_000,
    tokens: { input: 12500, output: 3200, cache_read: 8000, cache_create: 1500 },
    peakTurnContext: 15000,
    subagentCount: 2,
    tools: [
      { name: "Read", calls: 5, errors: 0 },
      { name: "Edit", calls: 3, errors: 1 },
    ],
    mcpServers: [{ name: "context-mode", tools: ["ctx_search"], calls: 2 }],
    totalToolCalls: 10,
    totalErrors: 1,
  };

  it("formats all stats fields including context", () => {
    const yaml = formatStatsYaml(baseStats);
    expect(yaml).toContain("model: claude-opus-4-6 (200K)");
    expect(yaml).toContain('duration: "5m"');
    expect(yaml).toContain("tokens_in: 12500");
    expect(yaml).toContain("tokens_out: 3200");
    expect(yaml).toContain("context_pct:");
    expect(yaml).toContain("subagents: 2");
    expect(yaml).toContain("tools_used: 10");
    expect(yaml).toContain("total_errors: 1");
    expect(yaml).toContain("mcp_servers:");
    expect(yaml).toContain("  - context-mode");
  });

  it("uses explicit contextCap when provided", () => {
    const yaml = formatStatsYaml(baseStats, 1_000_000);
    expect(yaml).toContain("model: claude-opus-4-6 (1M)");
  });

  it("omits mcp_servers when empty", () => {
    const stats = { ...baseStats, mcpServers: [] };
    const yaml = formatStatsYaml(stats);
    expect(yaml).not.toContain("mcp_servers:");
  });

  it("handles zero tokens", () => {
    const stats = {
      ...baseStats,
      tokens: { input: 0, output: 0, cache_read: 0, cache_create: 0 },
    };
    const yaml = formatStatsYaml(stats);
    expect(yaml).toContain("tokens_in: 0");
    expect(yaml).toContain("tokens_out: 0");
    expect(yaml).toContain("context_pct: 0");
  });
});

// ---- formatModelYaml ----

describe("formatModelYaml", () => {
  const stats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 0,
    tokens: { input: 50000, output: 10000, cache_read: 0, cache_create: 0 },
    peakTurnContext: 50000,
    subagentCount: 0,
    tools: [],
    mcpServers: [],
    totalToolCalls: 0,
    totalErrors: 0,
  };

  it("returns model with context cap label and context_pct", () => {
    const yaml = formatModelYaml(stats);
    expect(yaml).toContain("model: claude-opus-4-6 (200K)");
    expect(yaml).toContain("context_pct: 30"); // (50000+10000)/200000 = 30%
  });

  it("uses explicit contextCap when provided", () => {
    const yaml = formatModelYaml(stats, 1_000_000);
    expect(yaml).toContain("model: claude-opus-4-6 (1M)");
    expect(yaml).toContain("context_pct: 6"); // (50000+10000)/1000000 = 6%
  });

  it("returns empty string for null", () => {
    expect(formatModelYaml(null)).toBe("");
  });
});

// ---- formatToolTable ----

describe("formatToolTable", () => {
  it("renders markdown table rows", () => {
    const tools = [
      { name: "Read", calls: 5, errors: 0 },
      { name: "Bash", calls: 3, errors: 1 },
    ];
    const table = formatToolTable(tools);
    expect(table).toContain("| Tool | Calls | Errors |");
    expect(table).toContain("|------|------:|-------:|");
    expect(table).toContain("| Read | 5 | 0 |");
    expect(table).toContain("| Bash | 3 | 1 |");
  });

  it("returns empty string when no tools", () => {
    expect(formatToolTable([])).toBe("");
  });
});

// ---- mergeTranscriptStats ----

describe("mergeTranscriptStats", () => {
  const planStats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 60_000,
    tokens: { input: 5000, output: 1000, cache_read: 3000, cache_create: 500 },
    peakTurnContext: 8000,
    subagentCount: 1,
    tools: [
      { name: "Read", calls: 5, errors: 0 },
      { name: "Grep", calls: 2, errors: 0 },
    ],
    mcpServers: [{ name: "context-mode", tools: ["ctx_search"], calls: 1 }],
    totalToolCalls: 7,
    totalErrors: 0,
  };

  const execStats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 120_000,
    tokens: { input: 10000, output: 4000, cache_read: 7000, cache_create: 1000 },
    peakTurnContext: 15000,
    subagentCount: 2,
    tools: [
      { name: "Read", calls: 3, errors: 0 },
      { name: "Edit", calls: 8, errors: 1 },
      { name: "Bash", calls: 4, errors: 2 },
    ],
    mcpServers: [{ name: "context-mode", tools: ["ctx_execute"], calls: 3 }],
    totalToolCalls: 15,
    totalErrors: 3,
  };

  it("sums tokens across phases", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    expect(merged.tokens.input).toBe(15000);
    expect(merged.tokens.output).toBe(5000);
    expect(merged.tokens.cache_read).toBe(10000);
    expect(merged.tokens.cache_create).toBe(1500);
  });

  it("sums tool calls for same-named tools", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    const readTool = merged.tools.find((t) => t.name === "Read");
    expect(readTool?.calls).toBe(8);
    expect(readTool?.errors).toBe(0);
  });

  it("preserves unique tools from each phase", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    expect(merged.tools.find((t) => t.name === "Grep")).toBeDefined();
    expect(merged.tools.find((t) => t.name === "Edit")).toBeDefined();
    expect(merged.tools.find((t) => t.name === "Bash")).toBeDefined();
  });

  it("sums totals", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    expect(merged.totalToolCalls).toBe(22);
    expect(merged.totalErrors).toBe(3);
    expect(merged.subagentCount).toBe(3);
    expect(merged.durationMs).toBe(180_000);
  });

  it("merges MCP servers and unions tools", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    const srv = merged.mcpServers.find((s) => s.name === "context-mode");
    expect(srv).toBeDefined();
    expect(srv?.calls).toBe(4);
    expect(srv?.tools).toContain("ctx_search");
    expect(srv?.tools).toContain("ctx_execute");
  });

  it("picks non-unknown model", () => {
    const aUnknown = { ...planStats, model: "unknown" };
    const merged = mergeTranscriptStats(aUnknown, execStats);
    expect(merged.model).toBe("claude-opus-4-6");
  });

  it("takes max of peakTurnContext", () => {
    const merged = mergeTranscriptStats(planStats, execStats);
    expect(merged.peakTurnContext).toBe(15000);
  });
});

// ---- formatCcVersionYaml ----

describe("formatCcVersionYaml", () => {
  it("returns cc_version line with newline prefix", () => {
    expect(formatCcVersionYaml("v2.1.89")).toBe('\ncc_version: "v2.1.89"');
  });

  it("returns empty string for undefined", () => {
    expect(formatCcVersionYaml(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatCcVersionYaml("")).toBe("");
  });
});

// ---- formatToolsNoteContent ----

describe("formatToolsNoteContent", () => {
  const baseOpts = {
    planTitle: "My Plan",
    planDir: "Claude/Plans/2026/03-30/001-my-plan",
    journalPath: "Journal/2026/03-March/30-Monday",
    datetime: "2026-03-30T14:30",
  };

  const planStats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 60_000,
    tokens: { input: 5000, output: 1000, cache_read: 0, cache_create: 0 },
    peakTurnContext: 5000,
    subagentCount: 0,
    tools: [{ name: "Read", calls: 3, errors: 0 }],
    mcpServers: [],
    totalToolCalls: 3,
    totalErrors: 0,
  };

  const execStats: TranscriptStats = {
    model: "claude-opus-4-6",
    durationMs: 120_000,
    tokens: { input: 10000, output: 4000, cache_read: 0, cache_create: 0 },
    peakTurnContext: 10000,
    subagentCount: 1,
    tools: [
      { name: "Edit", calls: 5, errors: 1 },
      { name: "Bash", calls: 3, errors: 0 },
    ],
    mcpServers: [],
    totalToolCalls: 8,
    totalErrors: 1,
  };

  it("returns null when both phases are null", () => {
    expect(formatToolsNoteContent({ ...baseOpts, planStats: null, execStats: null })).toBeNull();
  });

  it("includes frontmatter with combined stats", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats,
    });
    expect(content).toContain("tools_used: 11");
    expect(content).toContain("total_errors: 1");
    expect(content).toContain("tokens_in: 15000");
    expect(content).toContain("tokens_out: 5000");
  });

  it("includes plan backlink in frontmatter", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
    });
    expect(content).toContain('plan: "[[Claude/Plans/2026/03-30/001-my-plan/plan|My Plan]]"');
  });

  it("renders both phase tables", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats,
    });
    expect(content).toContain("## Planning Phase");
    expect(content).toContain("## Execution Phase");
    expect(content).toContain("## Combined");
  });

  it("renders only planning phase when no execution", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
    });
    expect(content).toContain("## Planning Phase");
    expect(content).not.toContain("## Execution Phase");
  });

  it("renders only execution phase when no planning stats", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats: null,
      execStats,
    });
    expect(content).not.toContain("## Planning Phase");
    expect(content).toContain("## Execution Phase");
  });

  it("includes project in frontmatter when provided", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
      project: "capture-plan",
    });
    expect(content).toContain("project: capture-plan");
  });

  it("includes title in heading", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
    });
    expect(content).toContain("# Session Tools: My Plan");
  });

  it("includes context usage line in Combined section", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats,
    });
    // Combined: (15000+5000) / 200000 = 10%
    expect(content).toContain("**Context:");
    expect(content).toContain("(10%)");
  });

  it("uses explicit contextCap when provided", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats,
      contextCap: 1_000_000,
    });
    expect(content).toContain("model: claude-opus-4-6 (1M)");
  });

  it("includes cc_version in frontmatter when provided", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
      ccVersion: "v2.1.89",
    });
    expect(content).toContain('cc_version: "v2.1.89"');
  });

  it("omits cc_version when not provided", () => {
    const content = formatToolsNoteContent({
      ...baseOpts,
      planStats,
      execStats: null,
    });
    expect(content).not.toContain("cc_version");
  });
});

// ---- Tool Log Helpers ----

describe("escapeTableCell", () => {
  it("escapes pipe characters", () => {
    expect(escapeTableCell("foo|bar|baz")).toBe("foo\\|bar\\|baz");
  });

  it("converts newlines to <br>", () => {
    expect(escapeTableCell("line1\nline2")).toBe("line1<br>line2");
  });

  it("handles both pipes and newlines", () => {
    expect(escapeTableCell("a|b\nc|d")).toBe("a\\|b<br>c\\|d");
  });
});

describe("isCodeLike", () => {
  it("detects absolute paths", () => {
    expect(isCodeLike("file_path", "/src/foo.ts")).toBe(true);
  });

  it("detects relative paths", () => {
    expect(isCodeLike("path", "./src")).toBe(true);
    expect(isCodeLike("path", "../lib")).toBe(true);
  });

  it("detects home-relative paths", () => {
    expect(isCodeLike("path", "~/Documents")).toBe(true);
  });

  it("detects glob patterns", () => {
    expect(isCodeLike("pattern", "src/**/*.ts")).toBe(true);
  });

  it("detects file-extension-like values", () => {
    expect(isCodeLike("glob", "*.tsx")).toBe(true);
  });

  it("detects known enum keys", () => {
    expect(isCodeLike("subagent_type", "Explore")).toBe(true);
    expect(isCodeLike("output_mode", "content")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isCodeLike("description", "Find all files")).toBe(false);
  });
});

describe("langFromPath", () => {
  it("maps .ts to typescript", () => {
    expect(langFromPath("/src/foo.ts")).toBe("typescript");
  });

  it("maps .py to python", () => {
    expect(langFromPath("script.py")).toBe("python");
  });

  it("maps .json to json", () => {
    expect(langFromPath("config.json")).toBe("json");
  });

  it("returns empty string for unknown extensions", () => {
    expect(langFromPath("file.xyz")).toBe("");
  });

  it("returns empty string for no extension", () => {
    expect(langFromPath("Makefile")).toBe("");
  });
});

// ---- formatToolArgs ----

describe("formatToolArgs", () => {
  it("formats file_path as table with backticks", () => {
    const { table, codeFence } = formatToolArgs("Read", { file_path: "/src/foo.ts" });
    expect(table).toContain("| Read | |");
    expect(table).toContain("| file_path | `/src/foo.ts` |");
    expect(codeFence).toBe("");
  });

  it("puts each arg on its own table row", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello", path: "/src" });
    expect(table).toContain("| pattern | hello |");
    expect(table).toContain("| path | `/src` |");
  });

  it("truncates long string values", () => {
    const longVal = "a".repeat(150);
    const { table } = formatToolArgs("Agent", { description: longVal });
    expect(table).toContain("a".repeat(60));
    expect(table).toContain("… [150 total]");
  });

  it("shows length only for old_string and new_string", () => {
    const { table } = formatToolArgs("Edit", {
      old_string: "original code here",
      new_string: "replacement code here",
    });
    expect(table).toContain("| old_string | [18 chars] |");
    expect(table).toContain("| new_string | [21 chars] |");
  });

  it("handles boolean and number values with backticks", () => {
    const { table } = formatToolArgs("Grep", { multiline: true, offset: 42 });
    expect(table).toContain("| multiline | `true` |");
    expect(table).toContain("| offset | `42` |");
  });

  it("handles object values with JSON stringification", () => {
    const { table } = formatToolArgs("SomeTool", { options: { a: 1 } });
    expect(table).toContain('| options | {"a":1} |');
  });

  it("skips null and undefined values", () => {
    const { table } = formatToolArgs("Read", {
      file_path: "/src/foo.ts",
      extra: null,
      missing: undefined,
    });
    expect(table).toContain("| file_path | `/src/foo.ts` |");
    expect(table).not.toContain("extra");
    expect(table).not.toContain("missing");
  });

  it("returns empty table and codeFence for empty input", () => {
    const { table, codeFence } = formatToolArgs("Read", {});
    expect(table).toBe("");
    expect(codeFence).toBe("");
  });

  it("renders Bash command as separate code fence", () => {
    const { table, codeFence } = formatToolArgs("Bash", {
      command: "bun test 2>&1 | tail -30",
    });
    expect(table).toBe("");
    expect(codeFence).toBe("```sh\nbun test 2>&1 | tail -30\n```");
  });

  it("renders Bash args in table and command in code fence", () => {
    const { table, codeFence } = formatToolArgs("Bash", {
      command: "ls -la",
      description: "List files",
      timeout: 30000,
    });
    expect(table).toContain("| description | List files |");
    expect(table).toContain("| timeout | `30000` |");
    expect(codeFence).toBe("```sh\nls -la\n```");
  });

  it("escapes pipe characters in table cells", () => {
    const { table } = formatToolArgs("Grep", { pattern: "foo|bar" });
    expect(table).toContain("| pattern | foo\\|bar |");
  });

  it("preserves full Agent prompt without truncation", () => {
    const longPrompt = "Search for ".repeat(20); // 220 chars, over ARG_MAX_LEN
    const { table } = formatToolArgs("Agent", { prompt: longPrompt });
    expect(table).toContain(longPrompt.replace(/\|/g, "\\|"));
    expect(table).not.toContain("… [");
  });

  it("renders Agent prompt newlines as <br>", () => {
    const { table } = formatToolArgs("Agent", { prompt: "line one\nline two\nline three" });
    expect(table).toContain("line one<br>line two<br>line three");
  });

  it("extracts only plan title for ExitPlanMode", () => {
    const planContent = "# My Great Plan\n\nSome details here\n- step 1\n- step 2";
    const { table } = formatToolArgs("ExitPlanMode", {
      plan: planContent,
      allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
    });
    expect(table).toContain("| plan | My Great Plan |");
    expect(table).not.toContain("allowedPrompts");
    expect(table).not.toContain("Some details");
  });

  it("renders Write content as 5-line head code fence", () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const { table, codeFence } = formatToolArgs("Write", {
      file_path: "/src/app.ts",
      content,
    });
    expect(table).toContain("| file_path | `/src/app.ts` |");
    expect(table).not.toContain("content");
    expect(codeFence).toContain("```typescript");
    expect(codeFence).toContain("line 1");
    expect(codeFence).toContain("line 5");
    expect(codeFence).not.toContain("line 6");
    expect(codeFence).toContain("... [truncated, 20 lines total]");
  });

  it("renders Write content without truncation when ≤5 lines", () => {
    const content = "line 1\nline 2\nline 3";
    const { codeFence } = formatToolArgs("Write", {
      file_path: "/src/app.ts",
      content,
    });
    expect(codeFence).toContain("line 3");
    expect(codeFence).not.toContain("truncated");
  });

  it("renders ctx_execute code in language-typed fence", () => {
    const { table, codeFence } = formatToolArgs("mcp__ctx_execute", {
      language: "python",
      code: "print('hello')",
    });
    expect(codeFence).toBe("```python\nprint('hello')\n```");
    expect(table).not.toContain("language");
    expect(table).not.toContain("code");
  });

  it("backticks code-like values (paths, globs, enums)", () => {
    const { table } = formatToolArgs("Glob", { pattern: "src/**/*.ts" });
    expect(table).toContain("| pattern | `src/**/*.ts` |");
  });

  it("backticks subagent_type values", () => {
    const { table } = formatToolArgs("Agent", {
      subagent_type: "Explore",
      description: "Find things",
    });
    expect(table).toContain("| subagent_type | `Explore` |");
  });

  it("detects file-extension-like values as code", () => {
    const { table } = formatToolArgs("SomeTool", { glob: "*.tsx" });
    expect(table).toContain("| glob | `*.tsx` |");
  });

  it("replaces Agent prompt with wikilink when agentPromptLink provided", () => {
    const { table } = formatToolArgs(
      "Agent",
      { prompt: "Full markdown prompt content...", description: "Explore hooks" },
      { agentPromptLink: "[[plan/agents/7-1-explore-hooks\\|Explore hooks]]" },
    );
    expect(table).toContain("[[plan/agents/7-1-explore-hooks\\|Explore hooks]]");
    expect(table).not.toContain("Full markdown prompt content");
  });

  it("includes error mark in table header when provided", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello" }, { errorMark: " ❌" });
    expect(table).toContain("| Grep ❌ | |");
  });

  it("omits error mark from table header when not provided", () => {
    const { table } = formatToolArgs("Grep", { pattern: "hello" });
    expect(table).toContain("| Grep | |");
    expect(table).not.toContain("❌");
  });
});

// ---- formatToolsLogContent ----

describe("formatToolsLogContent", () => {
  const baseLogOpts = {
    planTitle: "My Plan",
    planDir: "Claude/Plans/2026/03-30/001-my-plan",
    journalPath: "Daily/2026/03-30",
    datetime: "2026-03-30 2:00 PM",
    project: "test-project",
  };

  const makeTurnLog = (overrides?: Partial<ToolLog>): ToolLog => ({
    turns: [
      {
        turnNumber: 1,
        timestamp: "2026-03-30T14:00:00.000Z",
        durationMs: 3000,
        tokensIn: 1200,
        tokensOut: 500,
        justification: "Checking the implementation",
        tools: [
          { seq: 1, name: "Read", input: { file_path: "/src/foo.ts" }, isError: false },
          { seq: 2, name: "Grep", input: { pattern: "hello" }, isError: true },
        ],
        isSidechain: false,
      },
    ],
    totalToolCalls: 2,
    totalErrors: 1,
    ...overrides,
  });

  it("returns null when both phases are null", () => {
    expect(formatToolsLogContent({ ...baseLogOpts, planLog: null, execLog: null })).toBeNull();
  });

  it("includes frontmatter with correct stats", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("total_tool_calls: 2");
    expect(md).toContain("total_errors: 1");
    expect(md).toContain("total_turns: 1");
    expect(md).toContain("planning_calls: 2");
    expect(md).not.toContain("execution_calls:");
    expect(md).toContain("project: test-project");
  });

  it("includes plan backlink in frontmatter", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("[[Claude/Plans/2026/03-30/001-my-plan/plan|My Plan]]");
  });

  it("renders planning phase with turn headers and block references", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("## Planning Phase");
    expect(md).toContain("### Turn 1: Read, Grep");
    expect(md).toContain("3.0s");
    expect(md).toContain("1,200 in");
    expect(md).toContain("500 out");
    expect(md).toContain("^turn-1");
  });

  it("renders justification as blockquote", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("> Checking the implementation");
  });

  it("renders tool names in heading and error mark in table header", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    const md = result?.markdown ?? "";
    // Tool names in turn heading
    expect(md).toContain("### Turn 1: Read, Grep");
    // No bold tool name lines
    expect(md).not.toContain("**Read**");
    expect(md).not.toContain("**Grep**");
    // Table args still present
    expect(md).toContain("| file_path | `/src/foo.ts` |");
    expect(md).toContain("| pattern | hello |");
    // Error mark in table header
    expect(md).toContain("| Grep ❌ | |");
  });

  it("renders both phases", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: makeTurnLog({
        turns: [
          {
            turnNumber: 1,
            timestamp: "2026-03-30T14:05:00.000Z",
            durationMs: 1000,
            tokensIn: 500,
            tokensOut: 200,
            justification: "",
            tools: [{ seq: 3, name: "Edit", input: { file_path: "a.ts" }, isError: false }],
            isSidechain: false,
          },
        ],
        totalToolCalls: 1,
        totalErrors: 0,
      }),
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("## Planning Phase");
    expect(md).toContain("## Execution Phase");
    expect(md).toContain("total_tool_calls: 3");
    expect(md).toContain("planning_calls: 2");
    expect(md).toContain("execution_calls: 1");
  });

  it("marks subagent turns with sidechain indicator", () => {
    const log = makeTurnLog({
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [{ seq: 1, name: "Bash", input: { command: "ls" }, isError: false }],
          isSidechain: true,
          agentId: "sub-1",
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    });
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    const md = result?.markdown ?? "";
    expect(md).toContain("🔀");
    expect(md).toContain("*Subagent: sub-1*");
  });

  it("includes title in heading", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.markdown).toContain("# Tool Log: My Plan");
  });

  it("includes cc_version when provided", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
      ccVersion: "1.0.30",
    });
    expect(result?.markdown).toContain('cc_version: "1.0.30"');
  });

  it("includes model when provided", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
      model: "claude-opus-4-6",
    });
    expect(result?.markdown).toContain("model: claude-opus-4-6");
  });

  it("returns empty agentFiles when no Agent tools present", () => {
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: makeTurnLog(),
      execLog: null,
    });
    expect(result?.agentFiles).toEqual([]);
  });

  it("collects agent files with frontmatter and replaces prompt with wikilink", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 7,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 5000,
          tokensIn: 31167,
          tokensOut: 1332,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Plan",
                description: "Explore hooks and config",
                prompt: "# Full markdown\n\nWith **bold** and lists\n- item 1",
              },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result).not.toBeNull();
    // Agent file collected
    expect(result?.agentFiles).toHaveLength(1);
    expect(result?.agentFiles[0].path).toBe(
      "Claude/Plans/2026/03-30/001-my-plan/agents/7-plan-my-plan",
    );
    // Content includes frontmatter followed by prompt
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("# Full markdown");
    expect(content).toContain("subagent_type: plan");
    expect(content).toContain('description: "Explore hooks and config"');
    expect(content).toContain("dispatched_at:");
    expect(content).toContain("tools-log#^turn-7|Turn 7");
    expect(content).toContain("[[Daily/2026/03-30|2026-03-30 2:00 PM]]");
    expect(content).toContain("[[Claude/Plans/2026/03-30/001-my-plan/plan|My Plan]]");
    // Wikilink in markdown
    expect(result?.markdown).toContain(
      "[[Claude/Plans/2026/03-30/001-my-plan/agents/7-plan-my-plan\\|Explore hooks and config]]",
    );
    // Original prompt text NOT in markdown
    expect(result?.markdown).not.toContain("With **bold** and lists");
    // Description skipped when prompt link present
    expect(result?.markdown).not.toContain("| description |");
    // Agent table header is bolded
    expect(result?.markdown).toContain("| **Agent** | |");
    // Tool name in heading with block ref
    expect(result?.markdown).toContain("### Turn 7: Agent");
    expect(result?.markdown).toContain("^turn-7");
  });

  it("uses fallback slug when Agent has no description and omits description from frontmatter", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 3,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { prompt: "Do something" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result?.agentFiles[0].path).toContain("agents/3-agent-my-plan");
    expect(result?.markdown).toContain("\\|agent-prompt]]");
    // Frontmatter should NOT include description when using default fallback
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("subagent_type: agent");
    expect(content).not.toContain("description:");
  });

  it("agent frontmatter includes sidechain stats when blockId matches", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 5,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 2000,
          tokensIn: 5000,
          tokensOut: 1000,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Explore",
                description: "Search codebase",
                prompt: "Find all tests",
              },
              isError: false,
              blockId: "toolu_abc123",
            },
          ],
          isSidechain: false,
        },
        {
          turnNumber: 6,
          timestamp: "2026-03-30T14:00:02.000Z",
          durationMs: 3000,
          tokensIn: 8000,
          tokensOut: 2000,
          justification: "",
          tools: [
            { seq: 2, name: "Glob", input: { pattern: "**/*.ts" }, isError: false },
            { seq: 3, name: "Read", input: { file_path: "a.ts" }, isError: false },
          ],
          isSidechain: true,
          agentId: "toolu_abc123",
        },
        {
          turnNumber: 7,
          timestamp: "2026-03-30T14:00:05.000Z",
          durationMs: 1500,
          tokensIn: 4000,
          tokensOut: 800,
          justification: "",
          tools: [{ seq: 4, name: "Grep", input: { pattern: "test" }, isError: false }],
          isSidechain: true,
          agentId: "toolu_abc123",
        },
      ],
      totalToolCalls: 4,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-opus-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("tokens_in: 12000");
    expect(content).toContain("tokens_out: 2800");
    expect(content).toContain("tool_calls: 3");
    expect(content).toContain("sidechain_turns: 2");
    expect(content).toContain('duration: "4.5s"');
    expect(content).toContain("model: claude-opus-4-6");
  });

  it("agent frontmatter omits sidechain stats when no matching turns", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 2,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 500,
          tokensOut: 200,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Plan", description: "Design", prompt: "Plan it" },
              isError: false,
              blockId: "toolu_no_match",
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("subagent_type: plan");
    expect(content).not.toContain("tokens_in:");
    expect(content).not.toContain("sidechain_turns:");
  });

  it("agent frontmatter uses tool.input.model when specified", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Explore", prompt: "Search", model: "haiku" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-opus-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    // tool.input.model takes priority over session model
    expect(content).toContain("model: haiku");
    expect(content).not.toContain("model: claude-opus-4-6");
  });

  it("agent frontmatter falls back to session model", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 1,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 1000,
          tokensIn: 100,
          tokensOut: 50,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: { subagent_type: "Explore", prompt: "Search" },
              isError: false,
            },
          ],
          isSidechain: false,
        },
      ],
      totalToolCalls: 1,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
      model: "claude-sonnet-4-6",
    });
    const content = result?.agentFiles[0].content ?? "";
    expect(content).toContain("model: claude-sonnet-4-6");
  });

  it("multiple agents in same turn get distinct frontmatter", () => {
    const log: ToolLog = {
      turns: [
        {
          turnNumber: 4,
          timestamp: "2026-03-30T14:00:00.000Z",
          durationMs: 2000,
          tokensIn: 1000,
          tokensOut: 500,
          justification: "",
          tools: [
            {
              seq: 1,
              name: "Agent",
              input: {
                subagent_type: "Explore",
                description: "First agent",
                prompt: "Prompt A",
              },
              isError: false,
              blockId: "toolu_a",
            },
            {
              seq: 2,
              name: "Agent",
              input: {
                subagent_type: "Plan",
                description: "Second agent",
                prompt: "Prompt B",
              },
              isError: false,
              blockId: "toolu_b",
            },
          ],
          isSidechain: false,
        },
        {
          turnNumber: 5,
          timestamp: "2026-03-30T14:00:02.000Z",
          durationMs: 1000,
          tokensIn: 300,
          tokensOut: 100,
          justification: "",
          tools: [{ seq: 3, name: "Read", input: { file_path: "x.ts" }, isError: false }],
          isSidechain: true,
          agentId: "toolu_b",
        },
      ],
      totalToolCalls: 3,
      totalErrors: 0,
    };
    const result = formatToolsLogContent({
      ...baseLogOpts,
      planLog: null,
      execLog: log,
    });
    expect(result?.agentFiles).toHaveLength(2);
    const [first, second] = result?.agentFiles ?? [];
    expect(first.content).toContain("subagent_type: explore");
    expect(first.content).not.toContain("sidechain_turns:");
    expect(second.content).toContain("subagent_type: plan");
    expect(second.content).toContain("sidechain_turns: 1");
    expect(second.content).toContain("tokens_in: 300");
  });
});

// ---- aggregateSidechainStats ----

describe("aggregateSidechainStats", () => {
  const makeTurn = (overrides: Partial<TurnLogEntry>): TurnLogEntry => ({
    turnNumber: 1,
    timestamp: "2026-03-30T14:00:00.000Z",
    durationMs: 1000,
    tokensIn: 500,
    tokensOut: 200,
    justification: "",
    tools: [{ seq: 1, name: "Read", input: {}, isError: false }],
    isSidechain: false,
    ...overrides,
  });

  it("sums stats across matching sidechain turns", () => {
    const turns = [
      makeTurn({ isSidechain: true, agentId: "a1", tokensIn: 100, tokensOut: 50, durationMs: 500 }),
      makeTurn({
        turnNumber: 2,
        isSidechain: true,
        agentId: "a1",
        tokensIn: 200,
        tokensOut: 80,
        durationMs: 700,
        tools: [
          { seq: 2, name: "Grep", input: {}, isError: false },
          { seq: 3, name: "Read", input: {}, isError: false },
        ],
      }),
    ];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.tokensIn).toBe(300);
    expect(stats.tokensOut).toBe(130);
    expect(stats.durationMs).toBe(1200);
    expect(stats.toolCalls).toBe(3);
    expect(stats.turnCount).toBe(2);
  });

  it("returns zeros when no turns match", () => {
    const turns = [makeTurn({ isSidechain: true, agentId: "other" })];
    const stats = aggregateSidechainStats(turns, "no-match");
    expect(stats.tokensIn).toBe(0);
    expect(stats.tokensOut).toBe(0);
    expect(stats.turnCount).toBe(0);
  });

  it("ignores non-sidechain turns even with matching agentId", () => {
    const turns = [makeTurn({ isSidechain: false, agentId: "a1", tokensIn: 999 })];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.turnCount).toBe(0);
    expect(stats.tokensIn).toBe(0);
  });

  it("ignores sidechain turns with different agentId", () => {
    const turns = [
      makeTurn({ isSidechain: true, agentId: "a1", tokensIn: 100 }),
      makeTurn({ isSidechain: true, agentId: "a2", tokensIn: 200 }),
    ];
    const stats = aggregateSidechainStats(turns, "a1");
    expect(stats.tokensIn).toBe(100);
    expect(stats.turnCount).toBe(1);
  });
});
