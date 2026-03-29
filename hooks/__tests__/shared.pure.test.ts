import { describe, it, expect } from "bun:test";
import {
  extractTitle,
  toSlug,
  stripTitleLine,
  formatAmPm,
  mergeTags,
  padCounter,
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
