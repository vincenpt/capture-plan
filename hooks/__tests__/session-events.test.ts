import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import {
  appendEvent,
  eventBufferPath,
  formatEventLine,
  readAndClearEvents,
  type SessionEvent,
  truncatePrompt,
} from "../shared.ts"

const TEST_SESSION_ID = "test-session-events-abc123"

afterEach(() => {
  // Clean up buffer file if it exists
  const path = eventBufferPath(TEST_SESSION_ID)
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
})

describe("eventBufferPath", () => {
  it("returns a path in tmpdir with the session id", () => {
    const path = eventBufferPath("abc-123")
    expect(path).toContain("capture-plan-events-abc-123.jsonl")
  })
})

describe("appendEvent", () => {
  it("creates the buffer file and writes a JSONL line", () => {
    const event: SessionEvent = { ts: "2026-04-05T14:00:00Z", type: "start" }
    appendEvent(TEST_SESSION_ID, event)

    const path = eventBufferPath(TEST_SESSION_ID)
    expect(existsSync(path)).toBe(true)

    const content = readFileSync(path, "utf8")
    const parsed = JSON.parse(content.trim())
    expect(parsed.ts).toBe("2026-04-05T14:00:00Z")
    expect(parsed.type).toBe("start")
  })

  it("appends multiple events as separate lines", () => {
    appendEvent(TEST_SESSION_ID, { ts: "2026-04-05T14:00:00Z", type: "start" })
    appendEvent(TEST_SESSION_ID, { ts: "2026-04-05T14:01:00Z", type: "prompt", text: "hello" })
    appendEvent(TEST_SESSION_ID, { ts: "2026-04-05T14:02:00Z", type: "stop" })

    const content = readFileSync(eventBufferPath(TEST_SESSION_ID), "utf8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[1]).type).toBe("prompt")
    expect(JSON.parse(lines[1]).text).toBe("hello")
  })
})

describe("readAndClearEvents", () => {
  it("returns empty array when buffer file does not exist", () => {
    const events = readAndClearEvents("nonexistent-session")
    expect(events).toEqual([])
  })

  it("reads events and deletes the buffer file", () => {
    appendEvent(TEST_SESSION_ID, { ts: "2026-04-05T14:00:00Z", type: "start" })
    appendEvent(TEST_SESSION_ID, { ts: "2026-04-05T14:01:00Z", type: "prompt", text: "test" })

    const events = readAndClearEvents(TEST_SESSION_ID)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("start")
    expect(events[1].type).toBe("prompt")
    expect(events[1].text).toBe("test")

    // Buffer file should be deleted
    expect(existsSync(eventBufferPath(TEST_SESSION_ID))).toBe(false)
  })

  it("skips malformed lines gracefully", () => {
    const path = eventBufferPath(TEST_SESSION_ID)
    writeFileSync(
      path,
      '{"ts":"2026-04-05T14:00:00Z","type":"start"}\nnot json\n{"ts":"2026-04-05T14:01:00Z","type":"stop"}\n',
    )

    const events = readAndClearEvents(TEST_SESSION_ID)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("start")
    expect(events[1].type).toBe("stop")
  })

  it("handles empty lines in buffer", () => {
    const path = eventBufferPath(TEST_SESSION_ID)
    writeFileSync(path, '{"ts":"2026-04-05T14:00:00Z","type":"start"}\n\n\n')

    const events = readAndClearEvents(TEST_SESSION_ID)
    expect(events).toHaveLength(1)
  })
})

describe("formatEventLine", () => {
  it("formats a start event", () => {
    const line = formatEventLine({ ts: "2026-04-05T14:32:00Z", type: "start" })
    expect(line).toContain("`start`")
    expect(line).toContain("Session started")
    expect(line).toMatch(/^- \*\*/)
  })

  it("formats a prompt event with text", () => {
    const line = formatEventLine({
      ts: "2026-04-05T14:33:00Z",
      type: "prompt",
      text: "Fix the bug",
    })
    expect(line).toContain("`prompt`")
    expect(line).toContain("Prompt")
    expect(line).toContain("Fix the bug")
  })

  it("formats mode change events", () => {
    const planLine = formatEventLine({ ts: "2026-04-05T14:35:00Z", type: "mode:plan" })
    expect(planLine).toContain("Entered plan mode")

    const normalLine = formatEventLine({ ts: "2026-04-05T14:38:00Z", type: "mode:normal" })
    expect(normalLine).toContain("Exited plan mode")
  })

  it("formats agent events", () => {
    const startLine = formatEventLine({
      ts: "2026-04-05T14:42:00Z",
      type: "agent:start",
      text: "Explore codebase",
    })
    expect(startLine).toContain("Subagent launched")
    expect(startLine).toContain("Explore codebase")

    const stopLine = formatEventLine({ ts: "2026-04-05T14:44:00Z", type: "agent:stop" })
    expect(stopLine).toContain("Subagent completed")
  })

  it("formats compact events", () => {
    const preLine = formatEventLine({ ts: "2026-04-05T14:50:00Z", type: "compact:pre" })
    expect(preLine).toContain("Context compacting")

    const postLine = formatEventLine({ ts: "2026-04-05T14:50:05Z", type: "compact:post" })
    expect(postLine).toContain("Context compacted")
  })

  it("formats a stop event", () => {
    const line = formatEventLine({ ts: "2026-04-05T14:45:00Z", type: "stop" })
    expect(line).toContain("Turn completed")
  })
})

describe("truncatePrompt", () => {
  it("returns short text unchanged", () => {
    expect(truncatePrompt("hello", 100)).toBe("hello")
  })

  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(150)
    const result = truncatePrompt(long, 100)
    expect(result).toHaveLength(103)
    expect(result.endsWith("...")).toBe(true)
  })

  it("returns exact-length text unchanged", () => {
    const exact = "a".repeat(100)
    expect(truncatePrompt(exact, 100)).toBe(exact)
  })
})
