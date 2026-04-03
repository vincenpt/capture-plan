import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXECUTION_TOOLS,
  findExitPlanIndex,
  findSuperpowersBoundary,
  findSuperpowersWrites,
  getContentBlocks,
  hasExecutionAfter,
  parseTranscript,
  type TranscriptEntry,
} from "../transcript.ts";
import { assistantEntry, humanEntry, writeEntry } from "./helpers/transcript-helpers.ts";

describe("getContentBlocks", () => {
  it("returns content array for assistant entry", () => {
    const entry: TranscriptEntry = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "tool_use", name: "Edit" },
        ],
      },
    };
    const blocks = getContentBlocks(entry);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("text");
    expect(blocks[1].name).toBe("Edit");
  });

  it("returns empty array for human entry", () => {
    const entry: TranscriptEntry = {
      type: "human",
      message: { role: "user", content: "hello" },
    };
    expect(getContentBlocks(entry)).toEqual([]);
  });

  it("returns empty array when content is a string", () => {
    const entry: TranscriptEntry = {
      type: "assistant",
      message: { role: "assistant", content: "just text" },
    };
    expect(getContentBlocks(entry)).toEqual([]);
  });

  it("returns empty array when message is undefined", () => {
    const entry: TranscriptEntry = { type: "assistant" };
    expect(getContentBlocks(entry)).toEqual([]);
  });

  it("returns empty array for non-assistant types", () => {
    const entry: TranscriptEntry = {
      type: "system",
      message: { role: "system", content: [{ type: "text", text: "sys" }] },
    };
    expect(getContentBlocks(entry)).toEqual([]);
  });
});

describe("parseTranscript", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cp-transcript-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    Bun.spawnSync(["rm", "-rf", tempDir]);
  });

  it("parses valid JSONL with multiple lines", () => {
    const file = join(tempDir, "test.jsonl");
    writeFileSync(
      file,
      `{"type":"human","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}
`,
    );
    const entries = parseTranscript(file);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("human");
    expect(entries[1].type).toBe("assistant");
  });

  it("skips blank lines", () => {
    const file = join(tempDir, "test.jsonl");
    writeFileSync(
      file,
      `{"type":"human"}

{"type":"assistant"}

`,
    );
    const entries = parseTranscript(file);
    expect(entries).toHaveLength(2);
  });

  it("skips malformed JSON lines", () => {
    const file = join(tempDir, "test.jsonl");
    writeFileSync(
      file,
      `{"type":"human"}
not json at all
{"type":"assistant"}
`,
    );
    const entries = parseTranscript(file);
    expect(entries).toHaveLength(2);
  });

  it("returns empty array for empty file", () => {
    const file = join(tempDir, "empty.jsonl");
    writeFileSync(file, "");
    expect(parseTranscript(file)).toEqual([]);
  });
});

describe("findExitPlanIndex", () => {
  it("finds the entry containing ExitPlanMode", () => {
    const entries: TranscriptEntry[] = [
      { type: "human", message: { role: "user", content: "do it" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
    ];
    expect(findExitPlanIndex(entries)).toBe(1);
  });

  it("returns -1 when no ExitPlanMode", () => {
    const entries: TranscriptEntry[] = [
      { type: "human", message: { role: "user", content: "hi" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Edit" }],
        },
      },
    ];
    expect(findExitPlanIndex(entries)).toBe(-1);
  });

  it("returns LAST index when multiple ExitPlanMode entries", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
    ];
    expect(findExitPlanIndex(entries)).toBe(2);
  });

  it("ignores non-assistant entries with matching names", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "human",
        message: {
          role: "user",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
    ];
    expect(findExitPlanIndex(entries)).toBe(-1);
  });

  it("returns -1 for empty entries", () => {
    expect(findExitPlanIndex([])).toBe(-1);
  });
});

describe("hasExecutionAfter", () => {
  const makeToolEntry = (name: string): TranscriptEntry => ({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name }],
    },
  });

  it("returns true for each execution tool type", () => {
    for (const tool of EXECUTION_TOOLS) {
      const entries: TranscriptEntry[] = [makeToolEntry("ExitPlanMode"), makeToolEntry(tool)];
      expect(hasExecutionAfter(entries, 0)).toBe(true);
    }
  });

  it("returns false for non-execution tools", () => {
    const entries: TranscriptEntry[] = [
      makeToolEntry("ExitPlanMode"),
      makeToolEntry("Read"),
      makeToolEntry("Glob"),
      makeToolEntry("Grep"),
    ];
    expect(hasExecutionAfter(entries, 0)).toBe(false);
  });

  it("returns false when no entries after index", () => {
    const entries: TranscriptEntry[] = [makeToolEntry("ExitPlanMode")];
    expect(hasExecutionAfter(entries, 0)).toBe(false);
  });

  it("returns false for only human entries after index", () => {
    const entries: TranscriptEntry[] = [
      makeToolEntry("ExitPlanMode"),
      { type: "human", message: { role: "user", content: "hi" } },
    ];
    expect(hasExecutionAfter(entries, 0)).toBe(false);
  });

  it("only checks entries after the given index", () => {
    const entries: TranscriptEntry[] = [
      makeToolEntry("Edit"), // before index
      makeToolEntry("ExitPlanMode"), // at index
      makeToolEntry("Read"), // after index, but not execution
    ];
    expect(hasExecutionAfter(entries, 1)).toBe(false);
  });
});

describe("findSuperpowersWrites", () => {
  it("detects spec writes", () => {
    const entries = [
      assistantEntry(),
      writeEntry(
        "/project/docs/superpowers/specs/2026-04-03-auth-design.md",
        "# Auth Design\n\nSpec body.",
      ),
      assistantEntry(),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(writes).toHaveLength(1);
    expect(writes[0].type).toBe("spec");
    expect(writes[0].index).toBe(1);
    expect(writes[0].title).toBe("Auth Design");
    expect(writes[0].filePath).toContain("superpowers/specs/");
  });

  it("detects plan writes", () => {
    const entries = [
      writeEntry(
        "/project/docs/superpowers/plans/2026-04-03-auth.md",
        "# Auth Implementation Plan\n\nTasks.",
      ),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(writes).toHaveLength(1);
    expect(writes[0].type).toBe("plan");
    expect(writes[0].title).toBe("Auth Implementation Plan");
  });

  it("detects both spec and plan in same session", () => {
    const entries = [
      writeEntry(
        "/project/docs/superpowers/specs/2026-04-03-auth-design.md",
        "# Auth Design\n\nSpec.",
      ),
      humanEntry(),
      writeEntry("/project/docs/superpowers/plans/2026-04-03-auth.md", "# Auth Plan\n\nPlan."),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(writes).toHaveLength(2);
    expect(writes[0].type).toBe("spec");
    expect(writes[1].type).toBe("plan");
  });

  it("ignores non-superpowers Write calls", () => {
    const entries = [
      writeEntry("/project/src/index.ts", "console.log('hello');"),
      writeEntry("/project/README.md", "# Readme"),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(writes).toHaveLength(0);
  });

  it("returns empty for entries with no Write tools", () => {
    const entries = [
      assistantEntry({ tools: [{ name: "Edit" }] }),
      assistantEntry({ tools: [{ name: "Bash" }] }),
    ];
    expect(findSuperpowersWrites(entries)).toHaveLength(0);
  });

  it("returns empty for empty entries", () => {
    expect(findSuperpowersWrites([])).toHaveLength(0);
  });

  it("uses custom patterns when provided", () => {
    const entries = [writeEntry("/project/design/specs/auth.md", "# Auth\n\nDesign.")];
    expect(findSuperpowersWrites(entries)).toHaveLength(0);
    expect(findSuperpowersWrites(entries, "/design/specs/")).toHaveLength(1);
    expect(findSuperpowersWrites(entries, "/design/specs/")[0].type).toBe("spec");
  });

  it("falls back to filename for title when no heading", () => {
    const entries = [
      writeEntry(
        "/project/docs/superpowers/specs/2026-04-03-auth-design.md",
        "No heading here, just body text.",
      ),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(writes[0].title).toBe("auth-design");
  });

  it("ignores non-assistant entries", () => {
    const entry = humanEntry();
    // Force a Write-like content on a human entry (shouldn't happen, but defensive)
    entry.message = {
      role: "user",
      content: [
        {
          type: "tool_use",
          name: "Write",
          input: { file_path: "/docs/superpowers/specs/x.md", content: "# X" },
        },
      ],
    };
    expect(findSuperpowersWrites([entry])).toHaveLength(0);
  });
});

describe("findSuperpowersBoundary", () => {
  it("returns plan index when both spec and plan exist", () => {
    const entries = [
      writeEntry("/project/docs/superpowers/specs/spec.md", "# Spec"),
      humanEntry(),
      writeEntry("/project/docs/superpowers/plans/plan.md", "# Plan"),
      assistantEntry({ tools: [{ name: "Edit" }] }),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(findSuperpowersBoundary(writes)).toBe(2);
  });

  it("returns spec index when only spec exists", () => {
    const entries = [
      writeEntry("/project/docs/superpowers/specs/spec.md", "# Spec"),
      assistantEntry({ tools: [{ name: "Bash" }] }),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(findSuperpowersBoundary(writes)).toBe(0);
  });

  it("returns last plan index when multiple plans exist", () => {
    const entries = [
      writeEntry("/project/docs/superpowers/plans/v1.md", "# V1"),
      humanEntry(),
      writeEntry("/project/docs/superpowers/plans/v2.md", "# V2"),
    ];
    const writes = findSuperpowersWrites(entries);
    expect(findSuperpowersBoundary(writes)).toBe(2);
  });

  it("returns -1 for empty writes", () => {
    expect(findSuperpowersBoundary([])).toBe(-1);
  });
});
