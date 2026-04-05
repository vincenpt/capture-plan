import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  classifyDateEntry,
  computeJournalMoves,
  computePlanMoves,
  detectVaultSchemes,
  executeMoves,
  parseDateFromPath,
} from "../lib/migration.ts"

let tempDir: string

beforeEach(() => {
  tempDir = join(import.meta.dir, `tmp-migration-${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function mkdirs(...paths: string[]): void {
  for (const p of paths) {
    mkdirSync(join(tempDir, p), { recursive: true })
  }
}

function touch(...paths: string[]): void {
  for (const p of paths) {
    const full = join(tempDir, p)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, "test")
  }
}

/** Walk a directory recursively and return all folder paths relative to root. */
function walkFolders(dir: string, prefix = ""): string[] {
  const folders: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        folders.push(rel)
        folders.push(...walkFolders(join(dir, entry.name), rel))
      }
    }
  } catch {
    /* skip */
  }
  return folders
}

/** Walk a directory recursively and return all file paths relative to root. */
function walkFilePaths(dir: string, prefix = ""): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        files.push(...walkFilePaths(join(dir, entry.name), rel))
      } else {
        files.push(rel)
      }
    }
  } catch {
    /* skip */
  }
  return files
}

/**
 * Mock Bun.spawnSync to simulate the Obsidian CLI using the real filesystem.
 * The mock maps vault-relative paths to absolute paths under tempDir.
 */
function mockObsidianCli(): ReturnType<typeof spyOn> {
  return spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
    const ok = (stdout = "") => ({
      exitCode: 0,
      success: true,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(""),
    })
    const err = (msg = "Error: not found") => ({
      exitCode: 1,
      success: false,
      stdout: Buffer.from(msg),
      stderr: Buffer.from(""),
    })

    // Extract common args
    const findArg = (prefix: string) =>
      cmd.find((a: string) => a.startsWith(prefix))?.slice(prefix.length)
    const command = cmd.find((a: string) => !a.startsWith("obsidian") && !a.startsWith("vault="))

    if (command === "folders") {
      const folder = findArg("folder=") ?? ""
      const absDir = join(tempDir, folder)
      try {
        statSync(absDir)
      } catch {
        return err()
      }
      const all = walkFolders(absDir)
      const lines = [folder, ...all.map((f) => `${folder}/${f}`)]
      return ok(lines.join("\n"))
    }

    if (command === "files") {
      const folder = findArg("folder=") ?? ""
      const absDir = join(tempDir, folder)
      try {
        statSync(absDir)
      } catch {
        return err()
      }
      const all = walkFilePaths(absDir)
      const lines = all.map((f) => `${folder}/${f}`)
      return ok(lines.join("\n"))
    }

    if (command === "folder") {
      const path = findArg("path=")
      if (!path) return err()
      const absDir = join(tempDir, path)
      try {
        const stat = statSync(absDir)
        if (!stat.isDirectory()) return err()
      } catch {
        return err()
      }
      const info = findArg("info=")
      if (info === "files") {
        const files = walkFilePaths(absDir)
        return ok(String(files.length))
      }
      if (info === "folders") {
        const folders = walkFolders(absDir)
        return ok(String(folders.length))
      }
      return ok(`path\t${path}\nfiles\t0\nfolders\t0\nsize\t0`)
    }

    if (command === "file") {
      const path = findArg("path=")
      if (!path) return err()
      try {
        const stat = statSync(join(tempDir, path))
        if (!stat.isFile()) return err()
        return ok(`path\t${path}`)
      } catch {
        return err()
      }
    }

    if (command === "move") {
      const pathArg = findArg("path=")
      const toArg = findArg("to=")
      if (pathArg && toArg) {
        const absFrom = join(tempDir, pathArg)
        const absTo = join(tempDir, toArg)
        mkdirSync(join(absTo, ".."), { recursive: true })
        renameSync(absFrom, absTo)
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

    if (command === "create") {
      const pathArg = findArg("path=")
      if (pathArg) {
        const absPath = join(tempDir, pathArg)
        mkdirSync(join(absPath, ".."), { recursive: true })
        writeFileSync(absPath, findArg("content=") ?? "")
      }
      return ok()
    }

    if (command === "vault") {
      const info = findArg("info=")
      if (info === "path") return ok(tempDir)
      return ok()
    }

    return ok()
  }) as typeof Bun.spawnSync)
}

describe("classifyDateEntry", () => {
  it("classifies compact entries", () => {
    expect(classifyDateEntry("04-03")).toBe("compact")
    expect(classifyDateEntry("12-31")).toBe("compact")
  })

  it("classifies calendar entries", () => {
    expect(classifyDateEntry("04-April", ["03-Friday", "04-Saturday"])).toBe("calendar")
  })

  it("classifies monthly entries", () => {
    expect(classifyDateEntry("04-April", ["03", "04"])).toBe("monthly")
  })

  it("returns undefined for unrecognized entries", () => {
    expect(classifyDateEntry("random")).toBeUndefined()
    expect(classifyDateEntry("04-April")).toBeUndefined() // no children
  })
})

describe("detectVaultSchemes", () => {
  let spy: ReturnType<typeof spyOn>
  beforeEach(() => {
    spy = mockObsidianCli()
  })
  afterEach(() => {
    spy?.mockRestore()
  })

  it("detects compact scheme", () => {
    mkdirs("base/2026/04-03/001-test")
    const schemes = detectVaultSchemes("base")
    expect(schemes.has("compact")).toBe(true)
    expect(schemes.size).toBe(1)
  })

  it("detects calendar scheme", () => {
    mkdirs("base/2026/04-April/03-Friday/001-test")
    const schemes = detectVaultSchemes("base")
    expect(schemes.has("calendar")).toBe(true)
    expect(schemes.size).toBe(1)
  })

  it("detects monthly scheme", () => {
    mkdirs("base/2026/04-April/03/001-test")
    const schemes = detectVaultSchemes("base")
    expect(schemes.has("monthly")).toBe(true)
    expect(schemes.size).toBe(1)
  })

  it("detects flat scheme", () => {
    mkdirs("base/2026-04-03/001-test")
    const schemes = detectVaultSchemes("base")
    expect(schemes.has("flat")).toBe(true)
  })

  it("detects multiple schemes in mixed vault", () => {
    mkdirs("base/2026/04-03/001-test", "base/2026/04-April/04-Saturday/002-other")
    const schemes = detectVaultSchemes("base")
    expect(schemes.has("compact")).toBe(true)
    expect(schemes.has("calendar")).toBe(true)
    expect(schemes.size).toBe(2)
  })

  it("returns empty set for non-existent path", () => {
    const schemes = detectVaultSchemes("nonexistent")
    expect(schemes.size).toBe(0)
  })
})

describe("parseDateFromPath", () => {
  it("parses compact date", () => {
    const date = parseDateFromPath("compact", "2026", ["04-03"])
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(3) // April (0-indexed)
    expect(date?.getDate()).toBe(3)
  })

  it("parses calendar date", () => {
    const date = parseDateFromPath("calendar", "2026", ["04-April", "03-Friday"])
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(3)
    expect(date?.getDate()).toBe(3)
  })

  it("parses monthly date", () => {
    const date = parseDateFromPath("monthly", "2026", ["04-April", "03"])
    expect(date).not.toBeNull()
    expect(date?.getMonth()).toBe(3)
    expect(date?.getDate()).toBe(3)
  })

  it("parses flat date", () => {
    const date = parseDateFromPath("flat", "", ["2026-04-03"])
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(3)
    expect(date?.getDate()).toBe(3)
  })
})

describe("computePlanMoves", () => {
  let spy: ReturnType<typeof spyOn>
  beforeEach(() => {
    spy = mockObsidianCli()
  })
  afterEach(() => {
    spy?.mockRestore()
  })

  it("computes moves from compact to calendar", () => {
    mkdirs("base/2026/04-03/001-test-plan")
    const moves = computePlanMoves("base", "compact", "calendar")
    expect(moves.length).toBe(1)
    expect(moves[0].from).toContain("04-03/001-test-plan")
    expect(moves[0].to).toContain("04-April/03-Friday/001-test-plan")
  })

  it("returns empty for same scheme", () => {
    mkdirs("base/2026/04-03/001-test")
    const moves = computePlanMoves("base", "compact", "compact")
    expect(moves.length).toBe(0)
  })

  it("handles multiple plans in one day", () => {
    mkdirs("base/2026/04-03/001-first", "base/2026/04-03/002-second")
    const moves = computePlanMoves("base", "compact", "calendar")
    expect(moves.length).toBe(2)
  })

  it("computes moves from calendar to compact", () => {
    mkdirs("base/2026/04-April/03-Friday/001-test-plan")
    const moves = computePlanMoves("base", "calendar", "compact")
    expect(moves.length).toBe(1)
    expect(moves[0].to).toContain("04-03/001-test-plan")
  })

  it("computes moves from flat to calendar", () => {
    mkdirs("base/2026-04-03/001-test-plan")
    const moves = computePlanMoves("base", "flat", "calendar")
    expect(moves.length).toBe(1)
    expect(moves[0].from).toContain("2026-04-03/001-test-plan")
    expect(moves[0].to).toContain("04-April/03-Friday/001-test-plan")
  })

  it("computes moves from calendar to flat", () => {
    mkdirs("base/2026/04-April/03-Friday/001-test-plan")
    const moves = computePlanMoves("base", "calendar", "flat")
    expect(moves.length).toBe(1)
    expect(moves[0].to).toContain("2026-04-03/001-test-plan")
  })
})

describe("computeJournalMoves", () => {
  let spy: ReturnType<typeof spyOn>
  beforeEach(() => {
    spy = mockObsidianCli()
  })
  afterEach(() => {
    spy?.mockRestore()
  })

  it("computes moves from compact to calendar", () => {
    touch("base/2026/03-29.md")
    const moves = computeJournalMoves("base", "compact", "calendar")
    expect(moves.length).toBe(1)
    expect(moves[0].from).toContain("03-29.md")
    expect(moves[0].to).toContain("03-March/29-Sunday.md")
  })

  it("computes moves from calendar to compact", () => {
    touch("base/2026/03-March/29-Sunday.md")
    const moves = computeJournalMoves("base", "calendar", "compact")
    expect(moves.length).toBe(1)
    expect(moves[0].to).toContain("03-29.md")
  })

  it("returns empty for same scheme", () => {
    touch("base/2026/03-March/29-Sunday.md")
    const moves = computeJournalMoves("base", "calendar", "calendar")
    expect(moves.length).toBe(0)
  })
})

describe("executeMoves", () => {
  let spy: ReturnType<typeof spyOn>
  beforeEach(() => {
    spy = mockObsidianCli()
  })
  afterEach(() => {
    spy?.mockRestore()
  })

  it("moves directories to new locations", () => {
    mkdirSync(join(tempDir, "src/001-test"), { recursive: true })
    writeFileSync(join(tempDir, "src/001-test/plan.md"), "test")

    const count = executeMoves([{ from: "src/001-test", to: "dst/001-test", type: "plan-dir" }])
    expect(count).toBe(1)
    expect(readdirSync(join(tempDir, "dst/001-test"))).toContain("plan.md")
  })

  it("skips moves where from equals to", () => {
    mkdirSync(join(tempDir, "same/001-test"), { recursive: true })
    const count = executeMoves([{ from: "same/001-test", to: "same/001-test", type: "plan-dir" }])
    expect(count).toBe(0)
  })
})
