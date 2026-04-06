import { describe, expect, it } from "bun:test"
import {
  ensureMdExt,
  escapeForObsidianAppend,
  escapeTableCell,
  extractTitle,
  filterNoiseTags,
  formatHashtags,
  formatJournalCallout,
  formatJournalRevision,
  formatModelLabel,
  formatNumber,
  formatSessionYaml,
  formatTagsYaml,
  getDayName,
  getProjectName,
  isCodeLike,
  langFromPath,
  mergeTags,
  padCounter,
  sessionDocPath,
  shortSessionId,
  stripTitleLine,
  toSlug,
} from "../shared.ts"

describe("extractTitle", () => {
  it("extracts a simple markdown heading", () => {
    expect(extractTitle("# My Plan")).toBe("My Plan")
  })

  it("strips plan: prefix (case insensitive)", () => {
    expect(extractTitle("# Plan: My Plan")).toBe("My Plan")
    expect(extractTitle("# plan: lowercase")).toBe("lowercase")
    expect(extractTitle("PLAN: Upper")).toBe("Upper")
  })

  it("skips leading blank lines", () => {
    expect(extractTitle("\n\n# Title")).toBe("Title")
  })

  it("strips backticks", () => {
    expect(extractTitle("# `refactor` auth")).toBe("refactor auth")
  })

  it("strips bold and italic markers", () => {
    expect(extractTitle("# **Bold** _Title_")).toBe("Bold Title")
  })

  it("handles multiple heading levels", () => {
    expect(extractTitle("## Sub Title")).toBe("Sub Title")
    expect(extractTitle("### Deep Title")).toBe("Deep Title")
  })

  it("returns plain text when no heading", () => {
    expect(extractTitle("Just a line")).toBe("Just a line")
  })

  it("returns 'Unnamed Plan' for empty string", () => {
    expect(extractTitle("")).toBe("Unnamed Plan")
  })

  it("returns 'Unnamed Plan' for whitespace-only", () => {
    expect(extractTitle("  \n  \n  ")).toBe("Unnamed Plan")
  })

  it("returns 'Unnamed Plan' for hash-only lines", () => {
    expect(extractTitle("###")).toBe("Unnamed Plan")
  })

  it("collapses multiple spaces", () => {
    expect(extractTitle("#  Too   Many   Spaces")).toBe("Too Many Spaces")
  })

  it("uses first non-empty line", () => {
    expect(extractTitle("# First\n# Second")).toBe("First")
  })
})

describe("toSlug", () => {
  it("converts a simple title", () => {
    expect(toSlug("My Plan")).toBe("my-plan")
  })

  it("replaces ampersand with 'and'", () => {
    expect(toSlug("Auth & Login")).toBe("auth-and-login")
  })

  it("strips special characters", () => {
    expect(toSlug("Plan: v2.0!")).toBe("plan-v20")
  })

  it("collapses multiple spaces and dashes", () => {
    expect(toSlug("too  many---dashes")).toBe("too-many-dashes")
  })

  it("removes leading and trailing dashes", () => {
    expect(toSlug("-lead-trail-")).toBe("lead-trail")
  })

  it("truncates at 80 chars on word boundary", () => {
    // Each word is 5 chars + dash = ~6 chars per word. 14 words ≈ 83 chars
    const longTitle = "alpha bravo delta gamma theta sigma omega kappa lambd zetta mu nu xi rho"
    const slug = toSlug(longTitle)
    expect(slug.length).toBeLessThanOrEqual(80)
    // Should not end with a dash
    expect(slug).not.toMatch(/-$/)
  })

  it("returns 'unnamed-plan' for empty string", () => {
    expect(toSlug("")).toBe("unnamed-plan")
  })

  it("returns 'unnamed-plan' for only special chars", () => {
    expect(toSlug("!@#$%")).toBe("unnamed-plan")
  })

  it("does not truncate a slug under 80 chars", () => {
    const title = "Short Title"
    expect(toSlug(title)).toBe("short-title")
  })

  it("handles multiple ampersands", () => {
    expect(toSlug("A & B & C")).toBe("a-and-b-and-c")
  })
})

describe("stripTitleLine", () => {
  it("strips heading and returns body", () => {
    expect(stripTitleLine("# Title\n\nBody text")).toBe("Body text")
  })

  it("strips leading blanks after title", () => {
    expect(stripTitleLine("# Title\n\n\nBody")).toBe("Body")
  })

  it("returns original when no title-like line found", () => {
    const input = "\n\n\n"
    expect(stripTitleLine(input)).toBe(input)
  })

  it("strips plan: prefix title", () => {
    expect(stripTitleLine("Plan: Title\nBody")).toBe("Body")
  })

  it("preserves multiple lines after title", () => {
    expect(stripTitleLine("# T\n\nL1\nL2")).toBe("L1\nL2")
  })

  it("handles content with no body after title", () => {
    expect(stripTitleLine("# Just a title")).toBe("")
  })

  it("handles title with formatting markers", () => {
    expect(stripTitleLine("## **Bold Title**\n\nBody")).toBe("Body")
  })
})

describe("mergeTags", () => {
  it("merges with no overlap", () => {
    expect(mergeTags(["a"], "b,c")).toBe("a,b,c")
  })

  it("deduplicates overlapping tags", () => {
    expect(mergeTags(["a", "b"], "b,c")).toBe("a,b,c")
  })

  it("handles empty existing array", () => {
    expect(mergeTags([], "x,y")).toBe("x,y")
  })

  it("handles empty new CSV", () => {
    expect(mergeTags(["a"], "")).toBe("a")
  })

  it("handles both empty", () => {
    expect(mergeTags([], "")).toBe("")
  })

  it("trims whitespace", () => {
    expect(mergeTags([" a "], " b , c ")).toBe("a,b,c")
  })

  it("returns existing when all new are duplicates", () => {
    expect(mergeTags(["a", "b"], "a,b")).toBe("a,b")
  })

  it("preserves order: existing first, then new", () => {
    expect(mergeTags(["z", "a"], "m,b")).toBe("z,a,m,b")
  })

  it("filters noise tags from merged result", () => {
    expect(mergeTags(["claude-session", "auth"], "config")).toBe("auth,config")
  })

  it("returns empty when all tags are noise", () => {
    expect(mergeTags(["claude-session"], "session")).toBe("")
  })
})

describe("filterNoiseTags", () => {
  it("strips known noise tags", () => {
    expect(filterNoiseTags("claude-session,auth")).toBe("auth")
  })

  it("preserves legitimate tags", () => {
    expect(filterNoiseTags("auth,config")).toBe("auth,config")
  })

  it("returns empty for all-noise input", () => {
    expect(filterNoiseTags("claude-session,coding-session")).toBe("")
  })

  it("returns empty for empty input", () => {
    expect(filterNoiseTags("")).toBe("")
  })

  it("does not strip partial matches", () => {
    expect(filterNoiseTags("claude-api,session-management")).toBe("claude-api,session-management")
  })

  it("strips all known noise tags", () => {
    expect(
      filterNoiseTags(
        "claude-session,claude-code,claude,coding-session,code-session,ai-session,session",
      ),
    ).toBe("")
  })

  it("trims whitespace around tags", () => {
    expect(filterNoiseTags(" claude-session , auth ")).toBe("auth")
  })
})

describe("padCounter", () => {
  it("pads single digit", () => {
    expect(padCounter(1)).toBe("001")
  })

  it("pads double digit", () => {
    expect(padCounter(42)).toBe("042")
  })

  it("keeps triple digit as-is", () => {
    expect(padCounter(100)).toBe("100")
  })

  it("does not truncate four digits", () => {
    expect(padCounter(1000)).toBe("1000")
  })

  it("pads zero", () => {
    expect(padCounter(0)).toBe("000")
  })
})

describe("getProjectName", () => {
  it("extracts basename from cwd", () => {
    expect(getProjectName("/Users/k/src/github/kriswill/capture-plan")).toBe("capture-plan")
  })

  it("returns empty string for undefined", () => {
    expect(getProjectName(undefined)).toBe("")
  })

  it("returns empty string for empty string", () => {
    expect(getProjectName("")).toBe("")
  })

  it("handles root path", () => {
    expect(getProjectName("/")).toBe("")
  })
})

describe("formatTagsYaml", () => {
  it("formats comma-separated tags as YAML list", () => {
    expect(formatTagsYaml("plugin-dev, hooks")).toBe("  - plugin-dev\n  - hooks")
  })

  it("handles single tag", () => {
    expect(formatTagsYaml("refactoring")).toBe("  - refactoring")
  })

  it("returns empty string for empty input", () => {
    expect(formatTagsYaml("")).toBe("")
  })

  it("trims whitespace from tags", () => {
    expect(formatTagsYaml("  foo ,  bar  ")).toBe("  - foo\n  - bar")
  })
})

describe("shortSessionId", () => {
  it("returns first 8 characters", () => {
    expect(shortSessionId("3a76e3ac-3e0b-44c4-8962-b02716a8138b")).toBe("3a76e3ac")
  })

  it("returns full string if shorter than 8", () => {
    expect(shortSessionId("abc")).toBe("abc")
  })
})

describe("sessionDocPath", () => {
  it("builds project-based path with first UUID segment", () => {
    expect(
      sessionDocPath("Claude/Sessions", "3a76e3ac-3e0b-44c4-8962-b02716a8138b", "capture-plan"),
    ).toBe("Claude/Sessions/capture-plan/3a76e3ac")
  })

  it("works with custom path", () => {
    expect(sessionDocPath("My/Sessions", "abcdef1234", "my-project")).toBe(
      "My/Sessions/my-project/abcdef1234",
    )
  })

  it("falls back to no-project when project is empty", () => {
    expect(sessionDocPath("Claude/Sessions", "3a76e3ac-3e0b-44c4-8962-b02716a8138b", "")).toBe(
      "Claude/Sessions/no-project/3a76e3ac",
    )
  })
})

describe("formatSessionYaml", () => {
  it("returns empty string when disabled", () => {
    expect(
      formatSessionYaml("3a76e3ac-3e0b-44c4-8962-b02716a8138b", false, "Claude/Sessions"),
    ).toBe("")
  })

  it("returns session YAML line with override path", () => {
    const result = formatSessionYaml(
      "3a76e3ac-3e0b-44c4-8962-b02716a8138b",
      true,
      "Claude/Sessions",
      "Claude/Sessions/capture-plan/001-3a76e3ac",
    )
    expect(result).toBe('\nsession: "[[Claude/Sessions/capture-plan/001-3a76e3ac|3a76e3ac]]"')
  })

  it("falls back to computed path when no override", () => {
    const result = formatSessionYaml("abcdef1234", true, "My/Path")
    expect(result).toBe('\nsession: "[[My/Path/no-project/abcdef1234|abcdef12]]"')
  })
})

describe("formatNumber", () => {
  it("formats small numbers without commas", () => {
    expect(formatNumber(42)).toBe("42")
  })

  it("formats thousands with commas", () => {
    expect(formatNumber(1234)).toBe("1,234")
  })

  it("formats large numbers with commas", () => {
    expect(formatNumber(1234567)).toBe("1,234,567")
  })

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0")
  })
})

describe("escapeTableCell", () => {
  it("escapes pipe characters", () => {
    expect(escapeTableCell("foo|bar|baz")).toBe("foo\\|bar\\|baz")
  })

  it("converts newlines to <br>", () => {
    expect(escapeTableCell("line1\nline2")).toBe("line1<br>line2")
  })

  it("handles both pipes and newlines", () => {
    expect(escapeTableCell("a|b\nc|d")).toBe("a\\|b<br>c\\|d")
  })
})

describe("isCodeLike", () => {
  it("detects absolute paths", () => {
    expect(isCodeLike("file_path", "/src/foo.ts")).toBe(true)
  })

  it("detects relative paths", () => {
    expect(isCodeLike("path", "./src")).toBe(true)
    expect(isCodeLike("path", "../lib")).toBe(true)
  })

  it("detects home-relative paths", () => {
    expect(isCodeLike("path", "~/Documents")).toBe(true)
  })

  it("detects glob patterns", () => {
    expect(isCodeLike("pattern", "src/**/*.ts")).toBe(true)
  })

  it("detects file-extension-like values", () => {
    expect(isCodeLike("glob", "*.tsx")).toBe(true)
  })

  it("detects known enum keys", () => {
    expect(isCodeLike("subagent_type", "Explore")).toBe(true)
    expect(isCodeLike("output_mode", "content")).toBe(true)
  })

  it("returns false for plain text", () => {
    expect(isCodeLike("description", "Find all files")).toBe(false)
  })
})

describe("langFromPath", () => {
  it("maps .ts to typescript", () => {
    expect(langFromPath("/src/foo.ts")).toBe("typescript")
  })

  it("maps .py to python", () => {
    expect(langFromPath("script.py")).toBe("python")
  })

  it("maps .json to json", () => {
    expect(langFromPath("config.json")).toBe("json")
  })

  it("returns empty string for unknown extensions", () => {
    expect(langFromPath("file.xyz")).toBe("")
  })

  it("returns empty string for no extension", () => {
    expect(langFromPath("Makefile")).toBe("")
  })
})

// ---- formatModelLabel ----

describe("formatModelLabel", () => {
  it("returns empty string when no model", () => {
    expect(formatModelLabel()).toBe("")
    expect(formatModelLabel(undefined, 200000)).toBe("")
  })

  it("returns model name alone when no context cap", () => {
    expect(formatModelLabel("opus-4")).toBe("opus-4")
    expect(formatModelLabel("opus-4", 0)).toBe("opus-4")
  })

  it("returns model with context cap label", () => {
    expect(formatModelLabel("opus-4", 200000)).toBe("opus-4(200K)")
    expect(formatModelLabel("sonnet-4", 1000000)).toBe("sonnet-4(1M)")
  })
})

// ---- formatHashtags ----

describe("formatHashtags", () => {
  it("formats comma-separated tags as hashtags", () => {
    expect(formatHashtags("auth,config")).toBe("#auth #config")
  })

  it("returns empty string for empty input", () => {
    expect(formatHashtags("")).toBe("")
    expect(formatHashtags("  ,  ")).toBe("")
  })

  it("trims whitespace", () => {
    expect(formatHashtags(" auth , config ")).toBe("#auth #config")
  })
})

// ---- formatJournalRevision ----

describe("formatJournalRevision", () => {
  it("builds a revision bullet with all fields", () => {
    const result = formatJournalRevision(
      "2:11 PM",
      "Plans/001-my-plan/plan",
      "plan",
      "opus-4(200K)",
      "Add configurable date schemes.",
      "config,date-schemes",
    )
    expect(result).toContain("> - **2:11 PM** [[Plans/001-my-plan/plan|plan]] `opus-4(200K)`")
    expect(result).toContain(">   Add configurable date schemes.")
    expect(result).toContain(">   #config #date-schemes")
  })

  it("omits model when empty", () => {
    const result = formatJournalRevision("2:11 PM", "path", "plan", "", "Summary.", "tag")
    expect(result).toContain("> - **2:11 PM** [[path|plan]]")
    expect(result).not.toContain("`")
  })

  it("omits tag line when no tags", () => {
    const result = formatJournalRevision("2:11 PM", "path", "plan", "opus-4(200K)", "Summary.", "")
    expect(result).not.toContain("#")
    const lines = result.split("\n")
    expect(lines).toHaveLength(2)
  })
})

// ---- formatJournalCallout ----

describe("formatJournalCallout", () => {
  it("builds a complete callout block", () => {
    const revision = `> - **2:11 PM** [[path|plan]] \`opus-4(200K)\`
>   Summary text.
>   #tag1`
    const result = formatJournalCallout("My Plan", "my-project", "plan-mode", revision)
    expect(result).toContain("> [!plan]+ My Plan")
    expect(result).toContain("> `my-project` \u00b7 `plan-mode`")
    expect(result).toContain(">\n")
    expect(result).toContain(revision)
  })

  it("omits project when empty", () => {
    const revision = "> - **2:11 PM** [[path|plan]]"
    const result = formatJournalCallout("My Plan", "", "plan-mode", revision)
    expect(result).toContain("> `plan-mode`")
    expect(result).not.toContain("\u00b7")
  })
})

// ---- escapeForObsidianAppend ----

describe("escapeForObsidianAppend", () => {
  it("escapes newlines", () => {
    expect(escapeForObsidianAppend("line1\nline2")).toBe("line1\\nline2")
  })

  it("escapes pipes in wikilinks", () => {
    expect(escapeForObsidianAppend("[[path|display]]")).toBe("[[path\\|display]]")
  })

  it("handles both newlines and wikilinks", () => {
    const input = "> [!plan]+ Title\n> - **2:11 PM** [[path|plan]]"
    const result = escapeForObsidianAppend(input)
    expect(result).toBe("> [!plan]+ Title\\n> - **2:11 PM** [[path\\|plan]]")
  })

  it("does not escape pipes outside wikilinks", () => {
    expect(escapeForObsidianAppend("a | b")).toBe("a | b")
  })
})

// ---- ensureMdExt ----

describe("ensureMdExt", () => {
  it("appends .md when missing", () => {
    expect(ensureMdExt("path/to/note")).toBe("path/to/note.md")
  })

  it("leaves .md paths unchanged", () => {
    expect(ensureMdExt("path/to/note.md")).toBe("path/to/note.md")
  })
})

// ---- getDayName ----

describe("getDayName", () => {
  it("returns a weekday name for a known date", () => {
    expect(getDayName(new Date("2026-04-04T12:00:00"))).toBe("Saturday")
  })

  it("returns a string when called with no argument", () => {
    const name = getDayName()
    expect(typeof name).toBe("string")
    expect(name.length).toBeGreaterThan(0)
  })
})
