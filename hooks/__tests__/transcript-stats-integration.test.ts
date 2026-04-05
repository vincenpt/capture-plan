import { describe, expect, it } from "bun:test"
import {
  collectToolLog,
  collectToolUsage,
  collectTranscriptStats,
  type TranscriptEntry,
} from "../transcript.ts"
import { assistantEntry, humanEntry } from "./helpers/transcript-helpers.ts"

describe("collectToolUsage", () => {
  it("tallies tool calls", () => {
    const entries = [
      assistantEntry({ tools: [{ name: "Read" }, { name: "Edit" }] }),
      humanEntry(),
      assistantEntry({ tools: [{ name: "Read" }] }),
      humanEntry(),
    ]
    const result = collectToolUsage(entries)
    expect(result.totalCalls).toBe(3)
    const readTool = result.tools.find((t) => t.name === "Read")
    expect(readTool?.calls).toBe(2)
    const editTool = result.tools.find((t) => t.name === "Edit")
    expect(editTool?.calls).toBe(1)
  })

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
    ]
    const result = collectToolUsage(entries)
    const bash = result.tools.find((t) => t.name === "Bash")
    expect(bash?.errors).toBe(1)
    const read = result.tools.find((t) => t.name === "Read")
    expect(read?.errors).toBe(0)
    expect(result.totalErrors).toBe(1)
  })

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
    ]
    const result = collectToolUsage(entries)
    expect(result.mcpServers).toHaveLength(2)
    const ctxServer = result.mcpServers.find((s) => s.name === "context-mode")
    expect(ctxServer?.calls).toBe(2)
    expect(ctxServer?.tools).toContain("context-mode__ctx_search")
    expect(ctxServer?.tools).toContain("context-mode__ctx_execute")
    const atlassian = result.mcpServers.find((s) => s.name === "atlassian")
    expect(atlassian?.calls).toBe(1)
  })

  it("handles MCP tool with no double-underscore separator after prefix", () => {
    const entries = [assistantEntry({ tools: [{ name: "mcp__singlepart" }] }), humanEntry()]
    const result = collectToolUsage(entries)
    expect(result.mcpServers).toHaveLength(1)
    expect(result.mcpServers[0].name).toBe("singlepart")
  })

  it("sorts tools by call count descending", () => {
    const entries = [
      assistantEntry({
        tools: [{ name: "Read" }, { name: "Edit" }, { name: "Read" }, { name: "Read" }],
      }),
      humanEntry(),
    ]
    const result = collectToolUsage(entries)
    expect(result.tools[0].name).toBe("Read")
    expect(result.tools[0].calls).toBe(3)
    expect(result.tools[1].name).toBe("Edit")
  })

  it("returns empty results for no tool usage", () => {
    const entries = [
      assistantEntry(), // text only, no tools
      humanEntry(),
    ]
    const result = collectToolUsage(entries)
    expect(result.totalCalls).toBe(0)
    expect(result.tools).toHaveLength(0)
    expect(result.mcpServers).toHaveLength(0)
  })

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ tools: [{ name: "Read" }] }),
      humanEntry(),
      assistantEntry({ tools: [{ name: "Edit" }] }),
      humanEntry(),
    ]
    const result = collectToolUsage(entries, 2, 3)
    expect(result.totalCalls).toBe(1)
    expect(result.tools[0].name).toBe("Edit")
  })
})

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
    ]

    const stats = collectTranscriptStats(entries)

    expect(stats.model).toBe("claude-opus-4-6")
    expect(stats.durationMs).toBe(5 * 60 * 1000)
    expect(stats.tokens.input).toBe(2000)
    expect(stats.tokens.output).toBe(850)
    expect(stats.tokens.cache_read).toBe(200)
    expect(stats.tokens.cache_create).toBe(0)
    expect(stats.peakTurnContext).toBe(1200) // 1000 + 200 cache_read
    expect(stats.subagentCount).toBe(1)
    expect(stats.totalToolCalls).toBe(3)
    expect(stats.totalErrors).toBe(0)
    expect(stats.tools).toHaveLength(3)
  })

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
    ]

    // Planning phase: entries 0-2
    const planStats = collectTranscriptStats(entries, 0, 2)
    expect(planStats.tokens.input).toBe(600) // 500 + 100
    expect(planStats.totalToolCalls).toBe(2) // Read + ExitPlanMode

    // Execution phase: entries 3-4
    const execStats = collectTranscriptStats(entries, 3, 4)
    expect(execStats.tokens.input).toBe(2000)
    expect(execStats.totalToolCalls).toBe(1) // Edit only
  })

  it("handles empty entries gracefully", () => {
    const stats = collectTranscriptStats([])
    expect(stats.model).toBe("unknown")
    expect(stats.durationMs).toBe(0)
    expect(stats.tokens.input).toBe(0)
    expect(stats.peakTurnContext).toBe(0)
    expect(stats.subagentCount).toBe(0)
    expect(stats.totalToolCalls).toBe(0)
    expect(stats.totalErrors).toBe(0)
  })
})

describe("collectToolLog", () => {
  it("builds chronological tool log from transcript", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [
          { name: "Read", id: "r1" },
          { name: "Grep", id: "g1" },
        ],
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check the files" },
            { type: "tool_use", name: "Read", id: "r1", input: { file_path: "/src/foo.ts" } },
            { type: "tool_use", name: "Grep", id: "g1", input: { pattern: "hello" } },
          ],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200 },
        },
      }),
      humanEntry({
        timestamp: "2026-03-30T14:00:03.000Z",
        toolResults: [{ tool_use_id: "r1" }, { tool_use_id: "g1", is_error: true }],
      }),
    ]

    const log = collectToolLog(entries)
    expect(log.totalToolCalls).toBe(2)
    expect(log.totalErrors).toBe(1)
    expect(log.turns).toHaveLength(1)

    const turn = log.turns[0]
    expect(turn.turnNumber).toBe(1)
    expect(turn.durationMs).toBe(3000)
    expect(turn.tokensIn).toBe(1200) // 1000 + 200 cache_read
    expect(turn.tokensOut).toBe(500)
    expect(turn.justification).toBe("Let me check the files")
    expect(turn.tools).toHaveLength(2)

    expect(turn.tools[0].seq).toBe(1)
    expect(turn.tools[0].name).toBe("Read")
    expect(turn.tools[0].input).toEqual({ file_path: "/src/foo.ts" })
    expect(turn.tools[0].isError).toBe(false)

    expect(turn.tools[1].seq).toBe(2)
    expect(turn.tools[1].name).toBe("Grep")
    expect(turn.tools[1].isError).toBe(true)
  })

  it("returns empty log for no tool uses", () => {
    const entries = [assistantEntry(), humanEntry()]
    const log = collectToolLog(entries)
    expect(log.totalToolCalls).toBe(0)
    expect(log.totalErrors).toBe(0)
    expect(log.turns).toHaveLength(0)
  })

  it("returns empty log for empty entries", () => {
    const log = collectToolLog([])
    expect(log.totalToolCalls).toBe(0)
    expect(log.turns).toHaveLength(0)
  })

  it("sequences tool calls across multiple turns", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [{ name: "Read", id: "r1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", id: "r1", input: { file_path: "a.ts" } }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
      assistantEntry({
        timestamp: "2026-03-30T14:00:02.000Z",
        tools: [{ name: "Edit", id: "e1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Edit", id: "e1", input: { file_path: "a.ts" } }],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:05.000Z" }),
    ]

    const log = collectToolLog(entries)
    expect(log.totalToolCalls).toBe(2)
    expect(log.turns).toHaveLength(2)
    expect(log.turns[0].tools[0].seq).toBe(1)
    expect(log.turns[1].tools[0].seq).toBe(2)
    expect(log.turns[0].turnNumber).toBe(1)
    expect(log.turns[1].turnNumber).toBe(2)
    expect(log.turns[1].durationMs).toBe(3000)
  })

  it("captures sidechain/agent info", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        isSidechain: true,
        agentId: "sub-1",
        tools: [{ name: "Bash", id: "b1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash", id: "b1", input: { command: "ls" } }],
          usage: { input_tokens: 50, output_tokens: 20 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
    ]

    const log = collectToolLog(entries)
    expect(log.turns[0].isSidechain).toBe(true)
    expect(log.turns[0].agentId).toBe("sub-1")
  })

  it("propagates blockId from content block to ToolLogEntry", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Agent", id: "toolu_abc123", input: { prompt: "test" } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
    ]
    const log = collectToolLog(entries)
    expect(log.turns[0].tools[0].blockId).toBe("toolu_abc123")
  })

  it("blockId is undefined when content block has no id", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", input: {} }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
    ]
    const log = collectToolLog(entries)
    expect(log.turns[0].tools[0].blockId).toBeUndefined()
  })

  it("respects range parameters", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [{ name: "Read", id: "r1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", id: "r1", input: {} }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
      assistantEntry({
        timestamp: "2026-03-30T14:00:02.000Z",
        tools: [{ name: "Edit", id: "e1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Edit", id: "e1", input: {} }],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:03.000Z" }),
    ]

    const log = collectToolLog(entries, 2, 3)
    expect(log.totalToolCalls).toBe(1)
    expect(log.turns).toHaveLength(1)
    expect(log.turns[0].tools[0].name).toBe("Edit")
    // seq should start at 1 within the range
    expect(log.turns[0].tools[0].seq).toBe(1)
  })

  it("extracts justification text preceding tool uses", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        timestamp: "2026-03-30T14:00:00.000Z",
        tools: [{ name: "Read", id: "r1" }],
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I need to check the config first." },
            { type: "text", text: "This will help me understand the format." },
            { type: "tool_use", name: "Read", id: "r1", input: { file_path: "config.toml" } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      humanEntry({ timestamp: "2026-03-30T14:00:01.000Z" }),
    ]

    const log = collectToolLog(entries)
    expect(log.turns[0].justification).toBe(
      "I need to check the config first.\n\nThis will help me understand the format.",
    )
  })

  it("handles zero duration when timestamps missing", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry({
        tools: [{ name: "Read", id: "r1" }],
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Read", id: "r1", input: {} }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        timestamp: undefined,
      }),
      humanEntry({ timestamp: undefined }),
    ]

    const log = collectToolLog(entries)
    expect(log.turns[0].durationMs).toBe(0)
    expect(log.turns[0].timestamp).toBe("")
  })
})
