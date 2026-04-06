import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionDoc, relocateSessionDoc, upsertSessionDoc } from "../lib/session-doc.ts"
import type { SessionConfig } from "../lib/types.ts"

let tempDir: string
let spy: ReturnType<typeof spyOn>

const SESSION_PATH = "Claude/Sessions"

function defaultSession(overrides?: Partial<SessionConfig>): SessionConfig {
  return { enabled: true, path: SESSION_PATH, ...overrides }
}

/**
 * Mock Bun.spawnSync to simulate the Obsidian CLI using a real temp filesystem.
 * Handles: vault info=path, read, create, move, delete, file (exists check).
 */
function mockObsidianCli(): ReturnType<typeof spyOn> {
  return spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
    const ok = (stdout = "") => ({
      exitCode: 0,
      success: true,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(""),
    })
    const err = (msg = "not found") => ({
      exitCode: 1,
      success: false,
      stdout: Buffer.from(msg),
      stderr: Buffer.from(""),
    })

    const findArg = (prefix: string) =>
      cmd.find((a: string) => a.startsWith(prefix))?.slice(prefix.length)
    const command = cmd.find((a: string) => !a.startsWith("obsidian") && !a.startsWith("vault="))

    if (command === "vault") {
      const info = findArg("info=")
      if (info === "path") return ok(tempDir)
      return ok()
    }

    if (command === "read") {
      const pathArg = findArg("path=")
      if (!pathArg) return err()
      try {
        const content = readFileSync(join(tempDir, pathArg), "utf8")
        return ok(content)
      } catch {
        return err()
      }
    }

    if (command === "create") {
      const pathArg = findArg("path=")
      if (pathArg) {
        const absPath = join(tempDir, pathArg.endsWith(".md") ? pathArg : `${pathArg}.md`)
        mkdirSync(join(absPath, ".."), { recursive: true })
        const content = (findArg("content=") ?? "").replace(/\\n/g, "\n")
        writeFileSync(absPath, content)
      }
      return ok()
    }

    if (command === "move") {
      const pathArg = findArg("path=")
      const toArg = findArg("to=")
      if (pathArg && toArg) {
        const absFrom = join(tempDir, pathArg)
        const absTo = join(tempDir, toArg)
        mkdirSync(join(absTo, ".."), { recursive: true })
        try {
          renameSync(absFrom, absTo)
        } catch {
          /* ignore */
        }
      }
      return ok()
    }

    if (command === "delete") {
      const pathArg = findArg("path=")
      if (pathArg) {
        try {
          rmSync(join(tempDir, pathArg), { recursive: true })
        } catch {
          /* ignore */
        }
      }
      return ok()
    }

    if (command === "file") {
      const pathArg = findArg("path=")
      if (!pathArg) return err()
      try {
        statSync(join(tempDir, pathArg))
        return ok(`path\t${pathArg}`)
      } catch {
        return err()
      }
    }

    return ok()
  }) as typeof Bun.spawnSync)
}

beforeEach(() => {
  tempDir = join(tmpdir(), `session-doc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
  spy = mockObsidianCli()
})

afterEach(() => {
  spy.mockRestore()
  rmSync(tempDir, { recursive: true, force: true })
})

describe("createSessionDoc", () => {
  it("creates a doc with 001 counter prefix in an empty project dir", () => {
    const result = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      started: "2026-04-05T10:00:00Z",
    })
    expect(result).toBe(`${SESSION_PATH}/my-app/001-aabb1122`)
  })

  it("increments counter based on existing entries", () => {
    // Pre-create directories that look like existing session docs
    const projectDir = join(tempDir, SESSION_PATH, "my-app")
    mkdirSync(join(projectDir, "001-deadbeef"), { recursive: true })
    mkdirSync(join(projectDir, "002-cafebabe"), { recursive: true })

    const result = createSessionDoc({
      sessionId: "ff001122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      started: "2026-04-05T10:00:00Z",
    })
    expect(result).toBe(`${SESSION_PATH}/my-app/003-ff001122`)
  })

  it("uses 'no-project' when project is empty", () => {
    const result = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "",
      started: "2026-04-05T10:00:00Z",
    })
    expect(result).toBe(`${SESSION_PATH}/no-project/001-aabb1122`)
  })

  it("returns null if doc already exists at the resolved path", () => {
    // Pre-create a directory and .md file matching the session prefix
    const projectDir = join(tempDir, SESSION_PATH, "my-app")
    mkdirSync(join(projectDir, "001-aabb1122"), { recursive: true })
    writeFileSync(join(projectDir, "001-aabb1122.md"), "---\nsession_id: aabb1122\n---\n")

    const result = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      started: "2026-04-05T10:00:00Z",
    })
    // resolveSessionDocPath finds the existing 001-aabb1122 entry, readVaultNote finds the doc → null
    expect(result).toBeNull()
  })

  it("finds existing doc when only .md file exists (no directory)", () => {
    // Simulate production: only .md files exist, no matching directories
    const projectDir = join(tempDir, SESSION_PATH, "my-app")
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "001-aabb1122.md"), "---\nsession_id: aabb1122\n---\n")

    const result = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      started: "2026-04-05T10:00:00Z",
    })
    // resolveSessionDocPath strips .md, matches 001-aabb1122 → returns existing path → null
    expect(result).toBeNull()
  })
})

describe("upsertSessionDoc", () => {
  it("uses cached sessionDocPath when provided", () => {
    const cachedPath = `${SESSION_PATH}/my-app/005-aabb1122`
    const result = upsertSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      sessionDocPath: cachedPath,
    })
    expect(result).toBe(true)
  })

  it("resolves counter-prefixed path when no cached path and doc exists", () => {
    // First create a session doc with a counter
    const docPath = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      started: "2026-04-05T10:00:00Z",
    })
    expect(docPath).toBe(`${SESSION_PATH}/my-app/001-aabb1122`)

    // Upsert without cached path — should find the existing doc
    const result = upsertSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      // no sessionDocPath — forces fallback resolution
      mode: "plan",
    })
    expect(result).toBe(true)
  })

  it("creates counter-prefixed doc when no cached path and no existing doc", () => {
    // Pre-create some existing entries in the project dir
    const projectDir = join(tempDir, SESSION_PATH, "my-app")
    mkdirSync(join(projectDir, "001-deadbeef"), { recursive: true })

    const result = upsertSessionDoc({
      sessionId: "ff001122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "my-app",
      // no sessionDocPath — forces fallback resolution
      events: [{ ts: "2026-04-05T10:00:00Z", type: "stop" }],
    })
    expect(result).toBe(true)

    // Verify the file was created with counter prefix 002

    expect(existsSync(join(projectDir, "002-ff001122.md"))).toBe(true)
  })

  it("never creates a counter-less doc path", () => {
    const result = upsertSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "test-proj",
    })
    expect(result).toBe(true)

    // The doc should be at 001-aabb1122.md, NOT aabb1122.md

    const projectDir = join(tempDir, SESSION_PATH, "test-proj")
    expect(existsSync(join(projectDir, "aabb1122.md"))).toBe(false)
    expect(existsSync(join(projectDir, "001-aabb1122.md"))).toBe(true)
  })
})

describe("relocateSessionDoc", () => {
  it("moves doc from no-project to correct project folder", () => {
    // Create a session doc under no-project
    const oldPath = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "",
      started: "2026-04-05T10:00:00Z",
    })
    expect(oldPath).toBe(`${SESSION_PATH}/no-project/001-aabb1122`)
    if (!oldPath) throw new Error("expected oldPath")

    // Relocate to "my-app"
    const newPath = relocateSessionDoc({
      oldDocPath: oldPath,
      newProject: "my-app",
      session: defaultSession(),
    })
    expect(newPath).toBe(`${SESSION_PATH}/my-app/001-aabb1122`)

    // New doc exists, old doc deleted
    expect(existsSync(join(tempDir, `${SESSION_PATH}/my-app/001-aabb1122.md`))).toBe(true)
    expect(existsSync(join(tempDir, `${SESSION_PATH}/no-project/001-aabb1122.md`))).toBe(false)
  })

  it("updates project field in frontmatter", () => {
    const oldPath = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "",
      started: "2026-04-05T10:00:00Z",
    })
    if (!oldPath) throw new Error("expected oldPath")

    const newPath = relocateSessionDoc({
      oldDocPath: oldPath,
      newProject: "my-app",
      session: defaultSession(),
    })
    if (!newPath) throw new Error("expected newPath")

    const content = readFileSync(join(tempDir, `${newPath}.md`), "utf8")
    expect(content).toContain('project: "my-app"')
  })

  it("assigns correct counter when target folder has existing docs", () => {
    // Pre-create existing entries in target project folder
    const projectDir = join(tempDir, SESSION_PATH, "my-app")
    mkdirSync(join(projectDir, "001-deadbeef"), { recursive: true })
    mkdirSync(join(projectDir, "002-cafebabe"), { recursive: true })

    // Create a doc under no-project
    const oldPath = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "",
      started: "2026-04-05T10:00:00Z",
    })
    if (!oldPath) throw new Error("expected oldPath")

    const newPath = relocateSessionDoc({
      oldDocPath: oldPath,
      newProject: "my-app",
      session: defaultSession(),
    })
    expect(newPath).toBe(`${SESSION_PATH}/my-app/003-aabb1122`)
  })

  it("merges content when target doc already exists", () => {
    // Create a doc under no-project with a start event
    const oldPath = createSessionDoc({
      sessionId: "aabb1122-0000-0000-0000-000000000000",
      session: defaultSession(),
      project: "",
      started: "2026-04-05T10:00:00Z",
    })
    if (!oldPath) throw new Error("expected oldPath")

    // Simulate another hook already creating a doc at the target with different content
    const targetPath = `${SESSION_PATH}/my-app/001-aabb1122`
    const targetContent = [
      "---",
      'session_id: "aabb1122-0000-0000-0000-000000000000"',
      'project: "my-app"',
      'started: "2026-04-05T10:00:00Z"',
      "mode: normal",
      "summaries:",
      '  - "[[some/summary|Summary]]"',
      "---",
      "# Session Log",
      "",
      "## Events",
      "",
      "- 10:11 PM `stop` — Turn completed",
      "",
    ].join("\n")

    // Write the target file directly to simulate pre-existing doc
    mkdirSync(join(tempDir, SESSION_PATH, "my-app"), { recursive: true })
    writeFileSync(join(tempDir, `${targetPath}.md`), targetContent)

    const newPath = relocateSessionDoc({
      oldDocPath: oldPath,
      newProject: "my-app",
      session: defaultSession(),
    })
    expect(newPath).toBe(targetPath)

    // Verify merged content
    const merged = readFileSync(join(tempDir, `${targetPath}.md`), "utf8")
    expect(merged).toContain('project: "my-app"')
    expect(merged).toContain("summaries:")
    expect(merged).toContain("stop")
    expect(merged).toContain("start")

    // Old doc should be deleted
    expect(existsSync(join(tempDir, `${SESSION_PATH}/no-project/001-aabb1122.md`))).toBe(false)
  })

  it("returns null when old doc does not exist", () => {
    const result = relocateSessionDoc({
      oldDocPath: `${SESSION_PATH}/no-project/001-nonexistent`,
      newProject: "my-app",
      session: defaultSession(),
    })
    expect(result).toBeNull()
  })
})
