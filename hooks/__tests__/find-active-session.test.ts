import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { findActiveSession } from "../lib/config.ts"

const TMP_DIR = join(import.meta.dir, ".tmp-sessions-test")

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true })
})

function writeSession(pid: number, data: Record<string, unknown>): void {
  writeFileSync(join(TMP_DIR, `${pid}.json`), JSON.stringify(data))
}

describe("findActiveSession", () => {
  it("returns the session matching the given CWD", () => {
    writeSession(1001, {
      pid: 1001,
      sessionId: "aaa-111",
      cwd: "/projects/foo",
      startedAt: Date.now() - 1000,
    })
    writeSession(1002, {
      pid: 1002,
      sessionId: "bbb-222",
      cwd: "/projects/bar",
      startedAt: Date.now() - 500,
    })

    const result = findActiveSession("/projects/foo", TMP_DIR)
    expect(result).not.toBeNull()
    expect(result?.sessionId).toBe("aaa-111")
  })

  it("picks the session with the highest startedAt when multiple match the CWD", () => {
    writeSession(2001, {
      pid: 2001,
      sessionId: "old-session",
      cwd: "/projects/multi",
      startedAt: Date.now() - 60_000,
    })
    writeSession(2002, {
      pid: 2002,
      sessionId: "new-session",
      cwd: "/projects/multi",
      startedAt: Date.now() - 1000,
    })

    const result = findActiveSession("/projects/multi", TMP_DIR)
    expect(result).not.toBeNull()
    expect(result?.sessionId).toBe("new-session")
  })

  it("returns null when no session matches the CWD", () => {
    const result = findActiveSession("/projects/nonexistent", TMP_DIR)
    expect(result).toBeNull()
  })

  it("skips malformed JSON files gracefully", () => {
    writeFileSync(join(TMP_DIR, "bad.json"), "not json{{{")
    writeSession(4001, {
      pid: 4001,
      sessionId: "good-one",
      cwd: "/projects/robust",
      startedAt: Date.now() - 1000,
    })

    const result = findActiveSession("/projects/robust", TMP_DIR)
    expect(result).not.toBeNull()
    expect(result?.sessionId).toBe("good-one")
  })

  it("returns null when sessions directory does not exist", () => {
    const result = findActiveSession("/any/cwd", "/nonexistent/path")
    expect(result).toBeNull()
  })
})
