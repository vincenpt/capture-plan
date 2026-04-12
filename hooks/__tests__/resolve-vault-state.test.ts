import { describe, expect, it, spyOn } from "bun:test"
import type { Config, ContextHint, SessionState } from "../shared.ts"
import * as shared from "../shared.ts"

type SpawnResult = {
  exitCode: number
  success: boolean
  stdout: Buffer
  stderr: Buffer
}

const TIMESTAMP = new Date().toISOString()
const PLAN_DIR = "Claude/Plans/2026/04-12/001-my-plan"
const SESSION_ID = "target-session"

/** Render a minimal valid state.md for the vault. */
function stateMd(overrides: Partial<SessionState> = {}): string {
  const defaults: SessionState = {
    session_id: SESSION_ID,
    plan_slug: "my-plan",
    plan_title: "My Plan",
    plan_dir: PLAN_DIR,
    date_key: "2026-04-12",
    timestamp: TIMESTAMP,
  }
  const s = { ...defaults, ...overrides }
  const lines = ["---"]
  lines.push(`session_id: ${s.session_id}`)
  lines.push(`plan_slug: ${s.plan_slug}`)
  lines.push(`plan_title: ${s.plan_title}`)
  lines.push(`plan_dir: ${s.plan_dir}`)
  lines.push(`date_key: ${s.date_key}`)
  lines.push(`timestamp: ${s.timestamp}`)
  if (s.completed) lines.push(`completed: true`)
  lines.push("---")
  return lines.join("\n")
}

/** Build a spawnSync spy that routes Obsidian CLI `read` to the provided body. */
function installSpawnSpy(opts: { readBody?: string | null; foldersBody?: string }): {
  restore: () => void
  calls: string[][]
} {
  const calls: string[][] = []
  const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
    calls.push([...cmd])
    const verb = cmd.find((c) => c === "read" || c === "folders" || c === "list")
    const result: SpawnResult = {
      exitCode: 0,
      success: true,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    }
    if (verb === "read" && opts.readBody != null) {
      result.stdout = Buffer.from(opts.readBody)
    } else if (verb === "read" && opts.readBody === null) {
      result.stdout = Buffer.from("Error: not found")
    } else if (verb === "folders") {
      result.stdout = Buffer.from(opts.foldersBody ?? "")
    }
    return result
  }) as typeof Bun.spawnSync)
  return { restore: () => spy.mockRestore(), calls }
}

const config: Config = {
  vault: "TestVault",
  plan: { path: "Claude/Plans", date_scheme: "calendar" },
  journal: { path: "Journal", date_scheme: "calendar" },
  session: { enabled: false, path: "Claude/Sessions" },
}

/** Build a ContextHint with sensible defaults for fields irrelevant to this suite. */
function makeHint(overrides: Partial<ContextHint>): ContextHint {
  return {
    session_id: SESSION_ID,
    source: "test",
    session_enabled: false,
    ...overrides,
  }
}

describe("resolveVaultState", () => {
  it("fast path: hint.plan_dir present → one CLI read, no folder scan", () => {
    const hint = makeHint({ plan_dir: PLAN_DIR })
    const { restore, calls } = installSpawnSpy({ readBody: stateMd() })
    const state = shared.resolveVaultState(SESSION_ID, hint, config)
    restore()

    expect(state).not.toBeNull()
    expect(state?.session_id).toBe(SESSION_ID)
    expect(state?.plan_dir).toBe(PLAN_DIR)
    // Fast path must not list folders; exactly one `read` is sufficient.
    const foldersCalls = calls.filter((c) => c.includes("folders"))
    const readCalls = calls.filter((c) => c.includes("read"))
    expect(foldersCalls.length).toBe(0)
    expect(readCalls.length).toBe(1)
    expect(readCalls[0]).toContain(`path=${PLAN_DIR}/state.md`)
  })

  it("fast path: session_id mismatch in state.md → null (no false reuse)", () => {
    const hint = makeHint({ plan_dir: PLAN_DIR })
    const { restore } = installSpawnSpy({
      readBody: stateMd({ session_id: "different-session" }),
    })
    const state = shared.resolveVaultState(SESSION_ID, hint, config)
    restore()
    expect(state).toBeNull()
  })

  it("fast path: completed=true in state.md → null", () => {
    const hint = makeHint({ plan_dir: PLAN_DIR })
    const { restore } = installSpawnSpy({
      readBody: stateMd({ completed: true }),
    })
    const state = shared.resolveVaultState(SESSION_ID, hint, config)
    restore()
    expect(state).toBeNull()
  })

  it("fast path: read fails (state.md missing) → null, no fallback scan", () => {
    const hint = makeHint({ plan_dir: PLAN_DIR })
    const { restore, calls } = installSpawnSpy({ readBody: null })
    const state = shared.resolveVaultState(SESSION_ID, hint, config)
    restore()
    expect(state).toBeNull()
    // Still no folder scan — we trust the hint and accept the miss.
    expect(calls.filter((c) => c.includes("folders")).length).toBe(0)
  })

  it("fallback: no hint → folder scan runs", () => {
    const { restore, calls } = installSpawnSpy({ foldersBody: "" })
    const state = shared.resolveVaultState(SESSION_ID, null, config)
    restore()
    expect(state).toBeNull()
    // scan should have invoked folders listing at least once (today and yesterday).
    expect(calls.filter((c) => c.includes("folders")).length).toBeGreaterThan(0)
  })

  it("fallback: undefined hint → folder scan runs", () => {
    const { restore, calls } = installSpawnSpy({ foldersBody: "" })
    shared.resolveVaultState(SESSION_ID, undefined, config)
    restore()
    expect(calls.filter((c) => c.includes("folders")).length).toBeGreaterThan(0)
  })

  it("fallback: hint without plan_dir → folder scan runs", () => {
    const hint = makeHint({})
    const { restore, calls } = installSpawnSpy({ foldersBody: "" })
    shared.resolveVaultState(SESSION_ID, hint, config)
    restore()
    expect(calls.filter((c) => c.includes("folders")).length).toBeGreaterThan(0)
  })
})
