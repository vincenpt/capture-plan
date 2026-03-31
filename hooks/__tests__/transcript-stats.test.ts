import { describe, expect, it } from "bun:test";
import {
  aggregateTokens,
  collectToolUsage,
  collectTranscriptStats,
  computeDurationMs,
  countSubagents,
  extractModel,
  getUserContentBlocks,
  peakTurnContext,
  type TranscriptEntry,
} from "../transcript.ts";

// ---- Helper to build transcript entries ----

function assistantEntry(
  overrides: Partial<TranscriptEntry> & { tools?: { name: string; id?: string }[] } = {},
): TranscriptEntry {
  const { tools, model, message: msgOverride, ...rest } = overrides;
  const content = tools
    ? tools.map((t) => ({ type: "tool_use" as const, name: t.name, id: t.id ?? t.name }))
    : [{ type: "text" as const, text: "some response" }];
  const message = msgOverride
    ? { model, ...msgOverride }
    : {
        role: "assistant" as const,
        model,
        content,
        usage: { input_tokens: 100, output_tokens: 50 },
      };
  return {
    type: "assistant",
    timestamp: "2026-03-30T14:00:00.000Z",
    message,
    ...rest,
  };
}

function humanEntry(
  overrides: Partial<TranscriptEntry> & {
    toolResults?: { tool_use_id: string; is_error?: boolean }[];
  } = {},
): TranscriptEntry {
  const { toolResults, ...rest } = overrides;
  const content = toolResults
    ? toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        ...(r.is_error ? { is_error: true as const } : {}),
      }))
    : [{ type: "text" as const, text: "user message" }];
  return {
    type: "human",
    timestamp: "2026-03-30T14:01:00.000Z",
    message: { role: "user", content },
    ...rest,
  };
}

// ---- getUserContentBlocks ----

describe("getUserContentBlocks", () => {
  it("returns content array for human entry", () => {
    const entry = humanEntry({
      toolResults: [{ tool_use_id: "abc", is_error: true }],
    });
    const blocks = getUserContentBlocks(entry);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].is_error).toBe(true);
  });

  it("returns empty array for assistant entry", () => {
    expect(getUserContentBlocks(assistantEntry())).toEqual([]);
  });

  it("returns empty array when content is a string", () => {
    const entry: TranscriptEntry = {
      type: "human",
      message: { role: "user", content: "just text" },
    };
    expect(getUserContentBlocks(entry)).toEqual([]);
  });

  it("returns empty array when message is undefined", () => {
    expect(getUserContentBlocks({ type: "human" })).toEqual([]);
  });
});

// ---- extractModel ----

describe("extractModel", () => {
  it("extracts model and strips date suffix", () => {
    const entries = [assistantEntry({ model: "claude-opus-4-6-20250624" })];
    expect(extractModel(entries)).toBe("claude-opus-4-6");
  });

  it("returns model as-is when no date suffix", () => {
    const entries = [assistantEntry({ model: "claude-haiku-4-5" })];
    expect(extractModel(entries)).toBe("claude-haiku-4-5");
  });

  it("returns 'unknown' when no assistant has model", () => {
    const entries = [humanEntry(), assistantEntry()];
    expect(extractModel(entries)).toBe("unknown");
  });

  it("returns first model in range", () => {
    const entries = [
      assistantEntry({ model: "claude-opus-4-6-20250624" }),
      assistantEntry({ model: "claude-haiku-4-5-20251001" }),
    ];
    expect(extractModel(entries)).toBe("claude-opus-4-6");
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ model: "claude-opus-4-6-20250624" }),
      assistantEntry({ model: "claude-haiku-4-5-20251001" }),
    ];
    expect(extractModel(entries, 1, 1)).toBe("claude-haiku-4-5");
  });

  it("handles empty entries", () => {
    expect(extractModel([])).toBe("unknown");
  });
});

// ---- computeDurationMs ----

describe("computeDurationMs", () => {
  it("computes duration between first and last entry", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:05:00.000Z" }),
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
    ];
    expect(computeDurationMs(entries)).toBe(10 * 60 * 1000);
  });

  it("returns 0 for single entry", () => {
    const entries = [assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" })];
    expect(computeDurationMs(entries)).toBe(0);
  });

  it("returns 0 when timestamps are missing", () => {
    const entries = [{ type: "assistant" }, { type: "human" }];
    expect(computeDurationMs(entries)).toBe(0);
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:05:00.000Z" }),
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
    ];
    expect(computeDurationMs(entries, 0, 1)).toBe(5 * 60 * 1000);
  });

  it("returns 0 for negative duration (clamps)", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
    ];
    expect(computeDurationMs(entries)).toBe(0);
  });
});

// ---- aggregateTokens ----

describe("aggregateTokens", () => {
  it("sums tokens across assistant entries", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "b" }],
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_read_input_tokens: 70,
            cache_creation_input_tokens: 20,
          },
        },
      }),
    ];
    const tokens = aggregateTokens(entries);
    expect(tokens.input).toBe(300);
    expect(tokens.output).toBe(150);
    expect(tokens.cache_read).toBe(100);
    expect(tokens.cache_create).toBe(30);
  });

  it("skips human entries", () => {
    const entries = [humanEntry(), humanEntry()];
    const tokens = aggregateTokens(entries);
    expect(tokens.input).toBe(0);
    expect(tokens.output).toBe(0);
  });

  it("handles missing usage gracefully", () => {
    const entries = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    ];
    const tokens = aggregateTokens(entries);
    expect(tokens.input).toBe(0);
    expect(tokens.output).toBe(0);
  });

  it("handles missing individual token fields", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ];
    const tokens = aggregateTokens(entries);
    expect(tokens.input).toBe(100);
    expect(tokens.output).toBe(50);
    expect(tokens.cache_read).toBe(0);
    expect(tokens.cache_create).toBe(0);
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "b" }],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ];
    const tokens = aggregateTokens(entries, 2, 2);
    expect(tokens.input).toBe(200);
    expect(tokens.output).toBe(100);
  });
});

// ---- peakTurnContext ----

describe("peakTurnContext", () => {
  it("returns the max single-turn context across entries", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 },
        },
      }),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "b" }],
          usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 100 },
        },
      }),
    ];
    // Turn 0: 1000 + 500 = 1500, Turn 2: 2000 + 100 = 2100
    expect(peakTurnContext(entries)).toBe(2100);
  });

  it("counts input_tokens without cache when cache_read is missing", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 5000, output_tokens: 100 },
        },
      }),
    ];
    expect(peakTurnContext(entries)).toBe(5000);
  });

  it("returns 0 for empty entries", () => {
    expect(peakTurnContext([])).toBe(0);
  });

  it("returns 0 when no usage data", () => {
    const entries = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    ];
    expect(peakTurnContext(entries)).toBe(0);
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 5000, output_tokens: 100 },
        },
      }),
      humanEntry(),
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "b" }],
          usage: { input_tokens: 1000, output_tokens: 50 },
        },
      }),
    ];
    expect(peakTurnContext(entries, 2, 2)).toBe(1000);
  });
});

// ---- countSubagents ----

describe("countSubagents", () => {
  it("counts unique sidechain agent IDs", () => {
    const entries = [
      assistantEntry({ isSidechain: true, agentId: "agent-1" }),
      humanEntry({ isSidechain: true, agentId: "agent-1" }),
      assistantEntry({ isSidechain: true, agentId: "agent-2" }),
      assistantEntry({ isSidechain: false, agentId: "main" }),
    ];
    expect(countSubagents(entries)).toBe(2);
  });

  it("returns 0 when no sidechains", () => {
    const entries = [assistantEntry({ isSidechain: false, agentId: "main" }), humanEntry()];
    expect(countSubagents(entries)).toBe(0);
  });

  it("ignores entries without agentId", () => {
    const entries = [assistantEntry({ isSidechain: true })];
    expect(countSubagents(entries)).toBe(0);
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ isSidechain: true, agentId: "agent-1" }),
      assistantEntry({ isSidechain: true, agentId: "agent-2" }),
      assistantEntry({ isSidechain: true, agentId: "agent-3" }),
    ];
    expect(countSubagents(entries, 0, 1)).toBe(2);
  });

  it("handles empty entries", () => {
    expect(countSubagents([])).toBe(0);
  });
});

// ---- collectToolUsage ----

describe("collectToolUsage", () => {
  it("tallies tool calls", () => {
    const entries = [
      assistantEntry({ tools: [{ name: "Read" }, { name: "Edit" }] }),
      humanEntry(),
      assistantEntry({ tools: [{ name: "Read" }] }),
      humanEntry(),
    ];
    const result = collectToolUsage(entries);
    expect(result.totalCalls).toBe(3);
    const readTool = result.tools.find((t) => t.name === "Read");
    expect(readTool?.calls).toBe(2);
    const editTool = result.tools.find((t) => t.name === "Edit");
    expect(editTool?.calls).toBe(1);
  });

  it("attributes errors to the correct tool", () => {
    const entries = [
      assistantEntry({
        tools: [
          { name: "Bash", id: "bash-1" },
          { name: "Read", id: "read-1" },
        ],
      }),
      humanEntry({
        toolResults: [{ tool_use_id: "bash-1", is_error: true }, { tool_use_id: "read-1" }],
      }),
    ];
    const result = collectToolUsage(entries);
    const bash = result.tools.find((t) => t.name === "Bash");
    expect(bash?.errors).toBe(1);
    const read = result.tools.find((t) => t.name === "Read");
    expect(read?.errors).toBe(0);
    expect(result.totalErrors).toBe(1);
  });

  it("parses MCP tool names into server groups", () => {
    const entries = [
      assistantEntry({
        tools: [
          { name: "mcp__context-mode__ctx_search" },
          { name: "mcp__context-mode__ctx_execute" },
          { name: "mcp__atlassian__searchJiraIssuesUsingJql" },
        ],
      }),
      humanEntry(),
    ];
    const result = collectToolUsage(entries);
    expect(result.mcpServers).toHaveLength(2);
    const ctxServer = result.mcpServers.find((s) => s.name === "context-mode");
    expect(ctxServer?.calls).toBe(2);
    expect(ctxServer?.tools).toContain("context-mode__ctx_search");
    expect(ctxServer?.tools).toContain("context-mode__ctx_execute");
    const atlassian = result.mcpServers.find((s) => s.name === "atlassian");
    expect(atlassian?.calls).toBe(1);
  });

  it("handles MCP tool with no double-underscore separator after prefix", () => {
    const entries = [assistantEntry({ tools: [{ name: "mcp__singlepart" }] }), humanEntry()];
    const result = collectToolUsage(entries);
    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0].name).toBe("singlepart");
  });

  it("sorts tools by call count descending", () => {
    const entries = [
      assistantEntry({
        tools: [{ name: "Read" }, { name: "Edit" }, { name: "Read" }, { name: "Read" }],
      }),
      humanEntry(),
    ];
    const result = collectToolUsage(entries);
    expect(result.tools[0].name).toBe("Read");
    expect(result.tools[0].calls).toBe(3);
    expect(result.tools[1].name).toBe("Edit");
  });

  it("returns empty results for no tool usage", () => {
    const entries = [
      assistantEntry(), // text only, no tools
      humanEntry(),
    ];
    const result = collectToolUsage(entries);
    expect(result.totalCalls).toBe(0);
    expect(result.tools).toHaveLength(0);
    expect(result.mcpServers).toHaveLength(0);
  });

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ tools: [{ name: "Read" }] }),
      humanEntry(),
      assistantEntry({ tools: [{ name: "Edit" }] }),
      humanEntry(),
    ];
    const result = collectToolUsage(entries, 2, 3);
    expect(result.totalCalls).toBe(1);
    expect(result.tools[0].name).toBe("Edit");
  });
});

// ---- collectTranscriptStats ----

describe("collectTranscriptStats", () => {
  it("composes all stats into a single object", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        model: "claude-opus-4-6-20250624",
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [
          { name: "Read", id: "r1" },
          { name: "Grep", id: "g1" },
        ],
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read", id: "r1" },
            { type: "tool_use", name: "Grep", id: "g1" },
          ],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200 },
        },
        isSidechain: false,
      }),
      humanEntry({
        timestamp: "2026-03-30T14:01:00.000Z",
        toolResults: [{ tool_use_id: "r1" }, { tool_use_id: "g1" }],
      }),
      assistantEntry({
        timestamp: "2026-03-30T14:02:00.000Z",
        tools: [{ name: "Agent", id: "a1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Agent", id: "a1" }],
          usage: { input_tokens: 500, output_tokens: 200 },
        },
        isSidechain: false,
      }),
      humanEntry({ timestamp: "2026-03-30T14:03:00.000Z" }),
      assistantEntry({
        timestamp: "2026-03-30T14:04:00.000Z",
        isSidechain: true,
        agentId: "sub-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "subagent work" }],
          usage: { input_tokens: 300, output_tokens: 100 },
        },
      }),
      assistantEntry({
        timestamp: "2026-03-30T14:05:00.000Z",
        isSidechain: false,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 200, output_tokens: 50 },
        },
      }),
    ];

    const stats = collectTranscriptStats(entries);

    expect(stats.model).toBe("claude-opus-4-6");
    expect(stats.durationMs).toBe(5 * 60 * 1000);
    expect(stats.tokens.input).toBe(2000);
    expect(stats.tokens.output).toBe(850);
    expect(stats.tokens.cache_read).toBe(200);
    expect(stats.tokens.cache_create).toBe(0);
    expect(stats.peakTurnContext).toBe(1200); // 1000 + 200 cache_read
    expect(stats.subagentCount).toBe(1);
    expect(stats.totalToolCalls).toBe(3);
    expect(stats.totalErrors).toBe(0);
    expect(stats.tools).toHaveLength(3);
  });

  it("works with a partial range (planning phase)", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        model: "claude-opus-4-6-20250624",
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [{ name: "Read" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read" }],
          usage: { input_tokens: 500, output_tokens: 200 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:02:00.000Z" }),
      // ExitPlanMode would be here at index 2
      assistantEntry({
        timestamp: "2026-03-30T14:03:00.000Z",
        tools: [{ name: "ExitPlanMode" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "ExitPlanMode" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:04:00.000Z" }),
      // Execution phase
      assistantEntry({
        timestamp: "2026-03-30T14:10:00.000Z",
        tools: [{ name: "Edit" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Edit" }],
          usage: { input_tokens: 2000, output_tokens: 1000 },
        },
      }),
    ];

    // Planning phase: entries 0-2
    const planStats = collectTranscriptStats(entries, 0, 2);
    expect(planStats.tokens.input).toBe(600); // 500 + 100
    expect(planStats.totalToolCalls).toBe(2); // Read + ExitPlanMode

    // Execution phase: entries 3-4
    const execStats = collectTranscriptStats(entries, 3, 4);
    expect(execStats.tokens.input).toBe(2000);
    expect(execStats.totalToolCalls).toBe(1); // Edit only
  });

  it("handles empty entries gracefully", () => {
    const stats = collectTranscriptStats([]);
    expect(stats.model).toBe("unknown");
    expect(stats.durationMs).toBe(0);
    expect(stats.tokens.input).toBe(0);
    expect(stats.peakTurnContext).toBe(0);
    expect(stats.subagentCount).toBe(0);
    expect(stats.totalToolCalls).toBe(0);
    expect(stats.totalErrors).toBe(0);
  });
});
