import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXECUTION_TOOLS,
  findExitPlanIndex,
  getContentBlocks,
  hasExecutionAfter,
  parseTranscript,
  type TranscriptEntry,
} from "../transcript.ts";

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
