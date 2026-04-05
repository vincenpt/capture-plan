import { describe, expect, it } from "bun:test"
import {
  aggregateTokens,
  computeDurationMs,
  countSubagents,
  extractModel,
  getUserContentBlocks,
  peakTurnContext,
  type TranscriptEntry,
} from "../transcript.ts"
import { assistantEntry, humanEntry } from "./helpers/transcript-helpers.ts"

describe("getUserContentBlocks", () => {
  it("returns content array for human entry", () => {
    const entry = humanEntry({
      toolResults: [{ tool_use_id: "abc", is_error: true }],
    })
    const blocks = getUserContentBlocks(entry)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe("tool_result")
    expect(blocks[0].is_error).toBe(true)
  })

  it("returns empty array for assistant entry", () => {
    expect(getUserContentBlocks(assistantEntry())).toEqual([])
  })

  it("returns empty array when content is a string", () => {
    const entry: TranscriptEntry = {
      type: "human",
      message: { role: "user", content: "just text" },
    }
    expect(getUserContentBlocks(entry)).toEqual([])
  })

  it("returns empty array when message is undefined", () => {
    expect(getUserContentBlocks({ type: "human" })).toEqual([])
  })
})

describe("extractModel", () => {
  it("extracts model and strips date suffix", () => {
    const entries = [assistantEntry({ model: "claude-opus-4-6-20250624" })]
    expect(extractModel(entries)).toBe("claude-opus-4-6")
  })

  it("returns model as-is when no date suffix", () => {
    const entries = [assistantEntry({ model: "claude-haiku-4-5" })]
    expect(extractModel(entries)).toBe("claude-haiku-4-5")
  })

  it("returns 'unknown' when no assistant has model", () => {
    const entries = [humanEntry(), assistantEntry()]
    expect(extractModel(entries)).toBe("unknown")
  })

  it("returns first model in range", () => {
    const entries = [
      assistantEntry({ model: "claude-opus-4-6-20250624" }),
      assistantEntry({ model: "claude-haiku-4-5-20251001" }),
    ]
    expect(extractModel(entries)).toBe("claude-opus-4-6")
  })

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ model: "claude-opus-4-6-20250624" }),
      assistantEntry({ model: "claude-haiku-4-5-20251001" }),
    ]
    expect(extractModel(entries, 1, 1)).toBe("claude-haiku-4-5")
  })

  it("handles empty entries", () => {
    expect(extractModel([])).toBe("unknown")
  })
})

describe("computeDurationMs", () => {
  it("computes duration between first and last entry", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:05:00.000Z" }),
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
    ]
    expect(computeDurationMs(entries)).toBe(10 * 60 * 1000)
  })

  it("returns 0 for single entry", () => {
    const entries = [assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" })]
    expect(computeDurationMs(entries)).toBe(0)
  })

  it("returns 0 when timestamps are missing", () => {
    const entries = [{ type: "assistant" }, { type: "human" }]
    expect(computeDurationMs(entries)).toBe(0)
  })

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:05:00.000Z" }),
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
    ]
    expect(computeDurationMs(entries, 0, 1)).toBe(5 * 60 * 1000)
  })

  it("returns 0 for negative duration (clamps)", () => {
    const entries = [
      assistantEntry({ timestamp: "2026-03-30T14:10:00.000Z" }),
      humanEntry({ timestamp: "2026-03-30T14:00:00.000Z" }),
    ]
    expect(computeDurationMs(entries)).toBe(0)
  })
})

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
    ]
    const tokens = aggregateTokens(entries)
    expect(tokens.input).toBe(300)
    expect(tokens.output).toBe(150)
    expect(tokens.cache_read).toBe(100)
    expect(tokens.cache_create).toBe(30)
  })

  it("skips human entries", () => {
    const entries = [humanEntry(), humanEntry()]
    const tokens = aggregateTokens(entries)
    expect(tokens.input).toBe(0)
    expect(tokens.output).toBe(0)
  })

  it("handles missing usage gracefully", () => {
    const entries = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    ]
    const tokens = aggregateTokens(entries)
    expect(tokens.input).toBe(0)
    expect(tokens.output).toBe(0)
  })

  it("handles missing individual token fields", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ]
    const tokens = aggregateTokens(entries)
    expect(tokens.input).toBe(100)
    expect(tokens.output).toBe(50)
    expect(tokens.cache_read).toBe(0)
    expect(tokens.cache_create).toBe(0)
  })

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
    ]
    const tokens = aggregateTokens(entries, 2, 2)
    expect(tokens.input).toBe(200)
    expect(tokens.output).toBe(100)
  })
})

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
    ]
    // Turn 0: 1000 + 500 = 1500, Turn 2: 2000 + 100 = 2100
    expect(peakTurnContext(entries)).toBe(2100)
  })

  it("counts input_tokens without cache when cache_read is missing", () => {
    const entries = [
      assistantEntry({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "a" }],
          usage: { input_tokens: 5000, output_tokens: 100 },
        },
      }),
    ]
    expect(peakTurnContext(entries)).toBe(5000)
  })

  it("returns 0 for empty entries", () => {
    expect(peakTurnContext([])).toBe(0)
  })

  it("returns 0 when no usage data", () => {
    const entries = [
      assistantEntry({ message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
    ]
    expect(peakTurnContext(entries)).toBe(0)
  })

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
    ]
    expect(peakTurnContext(entries, 2, 2)).toBe(1000)
  })
})

describe("countSubagents", () => {
  it("counts unique sidechain agent IDs", () => {
    const entries = [
      assistantEntry({ isSidechain: true, agentId: "agent-1" }),
      humanEntry({ isSidechain: true, agentId: "agent-1" }),
      assistantEntry({ isSidechain: true, agentId: "agent-2" }),
      assistantEntry({ isSidechain: false, agentId: "main" }),
    ]
    expect(countSubagents(entries)).toBe(2)
  })

  it("returns 0 when no sidechains", () => {
    const entries = [assistantEntry({ isSidechain: false, agentId: "main" }), humanEntry()]
    expect(countSubagents(entries)).toBe(0)
  })

  it("ignores entries without agentId", () => {
    const entries = [assistantEntry({ isSidechain: true })]
    expect(countSubagents(entries)).toBe(0)
  })

  it("respects range parameters", () => {
    const entries = [
      assistantEntry({ isSidechain: true, agentId: "agent-1" }),
      assistantEntry({ isSidechain: true, agentId: "agent-2" }),
      assistantEntry({ isSidechain: true, agentId: "agent-3" }),
    ]
    expect(countSubagents(entries, 0, 1)).toBe(2)
  })

  it("handles empty entries", () => {
    expect(countSubagents([])).toBe(0)
  })
})
