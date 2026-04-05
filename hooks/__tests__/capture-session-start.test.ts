import { describe, expect, it } from "bun:test"
import { parseModelContextCap } from "../capture-session-start.ts"
import { parseCcVersion } from "../shared.ts"

describe("parseModelContextCap", () => {
  it("parses [1m] as 1M tokens", () => {
    expect(parseModelContextCap("claude-opus-4-6[1m]")).toBe(1_000_000)
  })

  it("parses [200k] as 200K tokens", () => {
    expect(parseModelContextCap("claude-opus-4-6[200k]")).toBe(200_000)
  })

  it("parses [2m] as 2M tokens", () => {
    expect(parseModelContextCap("claude-sonnet-4-6[2m]")).toBe(2_000_000)
  })

  it("is case insensitive", () => {
    expect(parseModelContextCap("claude-opus-4-6[1M]")).toBe(1_000_000)
    expect(parseModelContextCap("claude-opus-4-6[200K]")).toBe(200_000)
  })

  it("returns undefined for bare model ID", () => {
    expect(parseModelContextCap("claude-opus-4-6")).toBeUndefined()
  })

  it("returns undefined for model with date suffix only", () => {
    expect(parseModelContextCap("claude-opus-4-6-20250624")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(parseModelContextCap("")).toBeUndefined()
  })
})

describe("parseCcVersion", () => {
  it("parses standard version output", () => {
    expect(parseCcVersion("2.1.89 (Claude Code)\n")).toBe("v2.1.89")
  })

  it("parses version without suffix", () => {
    expect(parseCcVersion("2.1.89\n")).toBe("v2.1.89")
  })

  it("parses version with extra whitespace", () => {
    expect(parseCcVersion("  2.1.89 (Claude Code)  \n")).toBe("v2.1.89")
  })

  it("returns undefined for empty string", () => {
    expect(parseCcVersion("")).toBeUndefined()
  })

  it("returns undefined for non-version output", () => {
    expect(parseCcVersion("error: command not found")).toBeUndefined()
  })

  it("returns undefined for partial version", () => {
    expect(parseCcVersion("2.1")).toBeUndefined()
  })
})
