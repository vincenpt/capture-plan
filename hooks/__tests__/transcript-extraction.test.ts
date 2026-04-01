import { describe, expect, it } from "bun:test";
import {
  collectAllAssistantText,
  collectChangedFiles,
  collectExecutionStats,
  type ExecutionStats,
  extractConclusionText,
  extractLastAssistantText,
  selectDoneText,
  type TranscriptEntry,
} from "../transcript.ts";

describe("extractLastAssistantText", () => {
  it("returns text from last assistant message", () => {
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
          content: [{ type: "text", text: "First text" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Last text" }],
        },
      },
    ];
    expect(extractLastAssistantText(entries, 0)).toBe("Last text");
  });

  it("joins multiple text blocks with double newline", () => {
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
          content: [
            { type: "text", text: "Part 1" },
            { type: "tool_use", name: "Read" },
            { type: "text", text: "Part 2" },
          ],
        },
      },
    ];
    expect(extractLastAssistantText(entries, 0)).toBe("Part 1\n\nPart 2");
  });

  it("ignores tool_use blocks", () => {
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
          content: [
            { type: "tool_use", name: "Edit" },
            { type: "text", text: "Result" },
          ],
        },
      },
    ];
    expect(extractLastAssistantText(entries, 0)).toBe("Result");
  });

  it("returns empty string when no text blocks found", () => {
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
          content: [{ type: "tool_use", name: "Edit" }],
        },
      },
    ];
    expect(extractLastAssistantText(entries, 0)).toBe("");
  });

  it("only searches after the given index", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Before" }],
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
    // afterIdx=1, nothing after it
    expect(extractLastAssistantText(entries, 1)).toBe("");
  });

  it("skips human entries when walking backwards", () => {
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
          content: [{ type: "text", text: "The answer" }],
        },
      },
      { type: "human", message: { role: "user", content: "thanks" } },
    ];
    expect(extractLastAssistantText(entries, 0)).toBe("The answer");
  });
});

describe("collectChangedFiles", () => {
  it("extracts file paths from Edit tool_use blocks", () => {
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
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/src/new.ts" },
            },
          ],
        },
      },
    ];
    expect(collectChangedFiles(entries, 0)).toEqual(["/src/app.ts", "/src/new.ts"]);
  });

  it("deduplicates files edited multiple times", () => {
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
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      },
    ];
    expect(collectChangedFiles(entries, 0)).toEqual(["/src/app.ts"]);
  });

  it("ignores Bash and Read tool blocks", () => {
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
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "git status" },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      },
    ];
    expect(collectChangedFiles(entries, 0)).toEqual([]);
  });

  it("returns empty array when no file tools after index", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
    ];
    expect(collectChangedFiles(entries, 0)).toEqual([]);
  });

  it("only checks entries after afterIdx", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/before.ts" },
            },
          ],
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
    expect(collectChangedFiles(entries, 1)).toEqual([]);
  });
});

describe("collectAllAssistantText", () => {
  it("collects text from ALL assistant entries after index", () => {
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
          content: [{ type: "text", text: "Editing files now" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "All done" }],
        },
      },
    ];
    expect(collectAllAssistantText(entries, 0)).toBe("Editing files now\n\nAll done");
  });

  it("skips human entries", () => {
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
          content: [{ type: "text", text: "Working" }],
        },
      },
      { type: "human", message: { role: "user", content: "ok" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    ];
    expect(collectAllAssistantText(entries, 0)).toBe("Working\n\nDone");
  });

  it("returns empty string when no text blocks after index", () => {
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
          content: [{ type: "tool_use", name: "Edit" }],
        },
      },
    ];
    expect(collectAllAssistantText(entries, 0)).toBe("");
  });

  it("only searches after the given index", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Before" }],
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
    expect(collectAllAssistantText(entries, 1)).toBe("");
  });
});

describe("collectExecutionStats", () => {
  it("returns all fields populated", () => {
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
          content: [
            { type: "text", text: "Editing now" },
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/src/app.ts" },
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "All done" }],
        },
      },
    ];
    const stats = collectExecutionStats(entries, 0);
    expect(stats.filesChanged).toEqual(["/src/app.ts"]);
    expect(stats.allAssistantText).toBe("Editing now\n\nAll done");
    expect(stats.lastAssistantText).toBe("All done");
    expect(stats.conclusionText).toBe("Editing now\n\nAll done");
  });

  it("handles empty transcript after ExitPlanMode", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
        },
      },
    ];
    const stats = collectExecutionStats(entries, 0);
    expect(stats.filesChanged).toEqual([]);
    expect(stats.allAssistantText).toBe("");
    expect(stats.lastAssistantText).toBe("");
    expect(stats.conclusionText).toBe("");
  });
});

describe("extractConclusionText", () => {
  it("collects text from last 3 assistant entries", () => {
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
          content: [{ type: "text", text: "Step 1" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Step 2" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final summary" }],
        },
      },
    ];
    expect(extractConclusionText(entries, 0)).toBe("Step 1\n\nStep 2\n\nFinal summary");
  });

  it("skips tool-only assistant entries", () => {
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
          content: [{ type: "text", text: "Working on it" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "TaskUpdate" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here is what was fixed" }],
        },
      },
    ];
    expect(extractConclusionText(entries, 0)).toBe("Working on it\n\nHere is what was fixed");
  });

  it("skips human entries", () => {
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
          content: [{ type: "text", text: "First" }],
        },
      },
      { type: "human", message: { role: "user", content: "ok" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Second" }],
        },
      },
    ];
    expect(extractConclusionText(entries, 0)).toBe("First\n\nSecond");
  });

  it("returns text in chronological order", () => {
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
          content: [{ type: "text", text: "A" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "B" }],
        },
      },
    ];
    // Should be A then B, not B then A
    expect(extractConclusionText(entries, 0)).toBe("A\n\nB");
  });

  it("respects maxEntries parameter", () => {
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
          content: [{ type: "text", text: "Old" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Recent" }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Latest" }],
        },
      },
    ];
    // maxEntries=1 should only get the last one
    expect(extractConclusionText(entries, 0, 1)).toBe("Latest");
    // maxEntries=2 should get last two
    expect(extractConclusionText(entries, 0, 2)).toBe("Recent\n\nLatest");
  });

  it("returns empty string when no text entries after index", () => {
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
          content: [{ type: "tool_use", name: "Edit" }],
        },
      },
    ];
    expect(extractConclusionText(entries, 0)).toBe("");
  });

  it("only searches after the given index", () => {
    const entries: TranscriptEntry[] = [
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Before" }],
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
    expect(extractConclusionText(entries, 1)).toBe("");
  });

  it("joins multiple text blocks within a single entry", () => {
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
          content: [
            { type: "text", text: "Part 1" },
            { type: "tool_use", name: "Read" },
            { type: "text", text: "Part 2" },
          ],
        },
      },
    ];
    expect(extractConclusionText(entries, 0)).toBe("Part 1\n\nPart 2");
  });
});

describe("selectDoneText", () => {
  const longText = "A".repeat(60); // > MIN_DONE_LENGTH (50)
  const shortText = "short";

  const makeStats = (overrides: Partial<ExecutionStats> = {}): ExecutionStats => ({
    filesChanged: [],
    allAssistantText: "",
    lastAssistantText: "",
    conclusionText: "",
    ...overrides,
  });

  it("prefers payload when long enough", () => {
    const stats = makeStats({
      conclusionText: `conclusion ${longText}`,
      lastAssistantText: `last ${longText}`,
    });
    expect(selectDoneText(`payload ${longText}`, stats, "summary")).toBe(`payload ${longText}`);
  });

  it("falls through to conclusionText when payload is short", () => {
    const stats = makeStats({ conclusionText: `conclusion ${longText}` });
    expect(selectDoneText(shortText, stats, "summary")).toBe(`conclusion ${longText}`);
  });

  it("falls through to lastAssistantText when conclusionText is short", () => {
    const stats = makeStats({ lastAssistantText: `last ${longText}` });
    expect(selectDoneText(shortText, stats, "summary")).toBe(`last ${longText}`);
  });

  it("falls through to summary as last resort", () => {
    const stats = makeStats();
    expect(selectDoneText(shortText, stats, "Haiku summary")).toBe("Haiku summary");
  });

  it("uses payload even when transcript text is also long", () => {
    const stats = makeStats({
      conclusionText: `conclusion ${longText}`,
      lastAssistantText: `last ${longText}`,
    });
    expect(selectDoneText(`payload ${longText}`, stats, "summary")).toBe(`payload ${longText}`);
  });
});
