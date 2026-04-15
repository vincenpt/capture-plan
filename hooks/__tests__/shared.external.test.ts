import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  appendToJournal,
  createVaultNote,
  getVaultPath,
  mergeTagsOnDailyNote,
  readVaultNote,
  readVaultProperty,
  runObsidian,
  setVaultProperty,
  summarizeWithClaude,
} from "../shared.ts"

// ---- Type-safe mock helpers for Bun process APIs ----

type SpawnSyncResult = ReturnType<typeof Bun.spawnSync>
type SpawnResult = ReturnType<typeof Bun.spawn>

function spawnSyncResult(overrides: {
  stdout?: string
  stderr?: string
  exitCode?: number
  success?: boolean
}): SpawnSyncResult {
  return {
    stdout: Buffer.from(overrides.stdout ?? ""),
    stderr: Buffer.from(overrides.stderr ?? ""),
    exitCode: overrides.exitCode ?? 0,
    success: overrides.success ?? true,
  } as SpawnSyncResult
}

interface SpawnSyncCall {
  cmd: string[]
  opts: unknown
}

// ---- runObsidian ----

describe("runObsidian", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("calls obsidian without vault", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "ok" }))

    const result = runObsidian(["create", "path=test"])
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 })
    expect(spawnSyncSpy).toHaveBeenCalledWith(["obsidian", "create", "path=test"], {
      stdout: "pipe",
      stderr: "pipe",
    })
  })

  it("calls obsidian with vault", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "ok" }))

    const result = runObsidian(["create", "path=test"], "MyVault")
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 })
    expect(spawnSyncSpy).toHaveBeenCalledWith(
      ["obsidian", "vault=MyVault", "create", "path=test"],
      { stdout: "pipe", stderr: "pipe" },
    )
  })

  it("trims stdout whitespace", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "  trimmed  \n" }),
    )

    const result = runObsidian(["test"])
    expect(result.stdout).toBe("trimmed")
  })

  it("returns exitCode 1 when stdout starts with Error:", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: 'Error: File "test.md" not found.', exitCode: 0 }),
    )

    const result = runObsidian(["append", "path=test.md"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('Error: File "test.md" not found.')
  })

  it("captures stderr from the CLI", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "", stderr: "vault not configured", exitCode: 1 }),
    )

    const result = runObsidian(["create", "path=test"])
    expect(result.stderr).toBe("vault not configured")
    expect(result.exitCode).toBe(1)
  })

  it("preserves original non-zero exitCode", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ exitCode: 2, success: false }),
    )

    const result = runObsidian(["test"])
    expect(result.exitCode).toBe(1)
  })

  it("returns exitCode 1 on spawn failure", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("spawn failed")
    })

    const result = runObsidian(["test"])
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 1 })
  })
})

// ---- createVaultNote ----

describe("createVaultNote", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("preserves newlines in content and calls runObsidian create with silent", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "ok" }))

    const result = createVaultNote("path/to/note", "line1\nline2\nline3", "MyVault")
    expect(result).toEqual({ success: true, exitCode: 0, stdout: "ok", stderr: "" })
    expect(spawnSyncSpy).toHaveBeenCalledWith(
      [
        "obsidian",
        "vault=MyVault",
        "create",
        "path=path/to/note",
        "content=line1\nline2\nline3",
        "overwrite",
        "silent",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
  })

  it("returns success false on failure", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "Error: vault not found", exitCode: 0 }),
    )

    const result = createVaultNote("path/to/note", "content")
    expect(result).toEqual({
      success: false,
      exitCode: 1,
      stdout: "Error: vault not found",
      stderr: "",
    })
  })
})

// ---- getVaultPath ----

describe("getVaultPath", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("returns path on success", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "/path/to/vault\n" }),
    )

    expect(getVaultPath()).toBe("/path/to/vault")
  })

  it("includes vault parameter when provided", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "/path/to/vault" }),
    )

    getVaultPath("MyVault")
    expect(spawnSyncSpy).toHaveBeenCalledWith(["obsidian", "vault=MyVault", "vault", "info=path"], {
      stdout: "pipe",
      stderr: "pipe",
    })
  })

  it("returns null on non-zero exit code", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stderr: "error", exitCode: 1, success: false }),
    )

    expect(getVaultPath()).toBeNull()
  })

  it("returns null on empty stdout", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({}))

    expect(getVaultPath()).toBeNull()
  })

  it("returns null when spawn throws", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockImplementation(() => {
      throw new Error("not found")
    })

    expect(getVaultPath()).toBeNull()
  })
})

// ---- summarizeWithClaude ----

describe("summarizeWithClaude", () => {
  let spawnSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSpy?.mockRestore()
  })

  function mockSpawn(output: string, exitCode: number) {
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(output))
          controller.close()
        },
      }),
      stderr: new ReadableStream({
        start(c) {
          c.close()
        },
      }),
      exited: Promise.resolve(exitCode),
      pid: 1234,
    } as SpawnResult)
  }

  it("parses successful 2-line output", async () => {
    mockSpawn("Summary of the plan\ntag1,tag2", 0)

    const result = await summarizeWithClaude("plan content", "system prompt")
    expect(result.summary).toBe("Summary of the plan")
    expect(result.tags).toBe("tag1,tag2")
  })

  it("falls back on non-zero exit code", async () => {
    mockSpawn("", 1)

    const result = await summarizeWithClaude(
      "Some plan content here for fallback testing",
      "system prompt",
    )
    expect(result.summary).toBe("Some plan content here for fallback testing")
    expect(result.tags).toBe("")
  })

  it("falls back when output contains 'not logged in'", async () => {
    mockSpawn("Error: not logged in\nplease login", 0)

    const result = await summarizeWithClaude("Fallback content", "system prompt")
    expect(result.summary).toBe("Fallback content")
    expect(result.tags).toBe("")
  })

  it("accepts long summaries from Haiku without truncation", async () => {
    const longSummary = "A".repeat(301)
    mockSpawn(`${longSummary}\ntag`, 0)

    const result = await summarizeWithClaude("Short content", "system prompt")
    expect(result.summary).toBe(longSummary)
  })

  it("strips code blocks in fallback", async () => {
    mockSpawn("", 1)

    const content = "Header\n```js\nconsole.log('hi');\n```\nAfter code"
    const result = await summarizeWithClaude(content, "system prompt")
    expect(result.summary).not.toContain("console.log")
    expect(result.summary).toContain("After code")
  })

  it("falls back to default message for empty content", async () => {
    mockSpawn("", 1)

    const result = await summarizeWithClaude("", "system prompt")
    expect(result.summary).toBe("Captured from Claude Code session.")
  })

  it("falls back when spawn throws", async () => {
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("command not found")
    })

    const result = await summarizeWithClaude("Content here", "system prompt")
    expect(result.summary).toBe("Content here")
    expect(result.tags).toBe("")
  })

  it("uses last line as tags when output has more than 2 lines", async () => {
    mockSpawn("Summary line\nExtra line\nfinal-tag", 0)

    const result = await summarizeWithClaude("content", "system prompt")
    expect(result.summary).toBe("Summary line")
    expect(result.tags).toBe("final-tag")
  })
})

// ---- appendToJournal ----

describe("appendToJournal", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>
  let calls: SpawnSyncCall[]

  beforeEach(() => {
    calls = []
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[], opts?: unknown) => {
      calls.push({ cmd: [...cmd], opts })
      return spawnSyncResult({})
    }) as typeof Bun.spawnSync)
  })

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("makes single append call on success", () => {
    appendToJournal("content", "Journal/2026/03/29.md")
    // One call: append
    expect(calls.length).toBe(1)
    expect(calls[0].cmd).toContain("append")
  })

  it("creates then retries append on first failure", () => {
    let callCount = 0
    spawnSyncSpy.mockImplementation(((cmd: string[], opts?: unknown) => {
      calls.push({ cmd: [...cmd], opts })
      callCount++
      // First call (append) fails, rest succeed
      return spawnSyncResult({
        exitCode: callCount === 1 ? 1 : 0,
        success: callCount !== 1,
      })
    }) as typeof Bun.spawnSync)

    appendToJournal("content", "Journal/2026/03/29.md")
    // Three calls: append (fail), create, append (retry)
    expect(calls.length).toBe(3)
    expect(calls[0].cmd).toContain("append")
    expect(calls[1].cmd).toContain("create")
    expect(calls[2].cmd).toContain("append")
  })

  it("creates file when CLI append reports error in stdout with exitCode 0", () => {
    let callCount = 0
    spawnSyncSpy.mockImplementation(((cmd: string[], opts?: unknown) => {
      calls.push({ cmd: [...cmd], opts })
      callCount++
      // First call: append returns exitCode 0 but Error: in stdout (real CLI behavior)
      if (callCount === 1) {
        return spawnSyncResult({
          stdout: 'Error: File "Journal/2026/04-April/01-Wednesday.md" not found.',
          exitCode: 0,
        })
      }
      return spawnSyncResult({})
    }) as typeof Bun.spawnSync)

    appendToJournal("content", "Journal/2026/04-April/01-Wednesday")
    expect(calls.length).toBe(3)
    expect(calls[0].cmd).toContain("append")
    expect(calls[1].cmd).toContain("create")
    expect(calls[2].cmd).toContain("append")
  })

  it("create call uses .md path", () => {
    let callCount = 0
    spawnSyncSpy.mockImplementation(((cmd: string[], opts?: unknown) => {
      calls.push({ cmd: [...cmd], opts })
      callCount++
      return spawnSyncResult({
        exitCode: callCount === 1 ? 1 : 0,
        success: callCount !== 1,
      })
    }) as typeof Bun.spawnSync)

    appendToJournal("content", "Journal/2026/04-April/04-Saturday")
    const createCall = calls[1]
    const pathArg = createCall.cmd.find((a: string) => a.startsWith("path="))
    expect(pathArg).toBe("path=Journal/2026/04-April/04-Saturday.md")
    expect(createCall.cmd).not.toContain("silent")
  })

  it("appends .md extension if missing", () => {
    appendToJournal("content", "Journal/2026/03/29")
    const appendCall = calls[0]
    const pathArg = appendCall.cmd.find((a: string) => a.startsWith("path="))
    expect(pathArg).toBe("path=Journal/2026/03/29.md")
  })

  it("does not double .md extension", () => {
    appendToJournal("content", "Journal/2026/03/29.md")
    const appendCall = calls[0]
    const pathArg = appendCall.cmd.find((a: string) => a.startsWith("path="))
    expect(pathArg).toBe("path=Journal/2026/03/29.md")
  })
})

// ---- mergeTagsOnDailyNote ----

describe("mergeTagsOnDailyNote", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>
  let calls: string[][]

  beforeEach(() => {
    calls = []
  })

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("returns early on empty journalPath", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({}))

    mergeTagsOnDailyNote("tag1", "", "vault")
    expect(spawnSyncSpy).not.toHaveBeenCalled()
  })

  it("calls property:read then property:set", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      calls.push([...cmd])
      // property:read returns existing tags
      if (cmd.includes("property:read")) {
        return spawnSyncResult({ stdout: "existing-tag\n" })
      }
      return spawnSyncResult({})
    }) as typeof Bun.spawnSync)

    mergeTagsOnDailyNote("new-tag", "Journal/2026/03/29", "vault")

    expect(calls.length).toBe(2)
    expect(calls[0]).toContain("property:read")
    expect(calls[1]).toContain("property:set")
    // Verify merged tags
    const valueArg = calls[1].find((a) => a.startsWith("value="))
    expect(valueArg).toBe("value=existing-tag,new-tag")
  })

  it("appends .md extension to journal path", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({}))

    mergeTagsOnDailyNote("tag", "Journal/path", "vault")
    const readCall = spawnSyncSpy.mock.calls[0][0] as string[]
    const pathArg = readCall.find((a) => a.startsWith("path="))
    expect(pathArg).toBe("path=Journal/path.md")
  })
})

describe("readVaultNote", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("returns content on success", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "---\nkey: value\n---" }),
    )

    const result = readVaultNote("Plans/001/state", "vault")
    expect(result).toBe("---\nkey: value\n---")

    const cmd = spawnSyncSpy.mock.calls[0][0] as string[]
    expect(cmd).toContain("read")
    expect(cmd).toContain("path=Plans/001/state.md")
    expect(cmd).toContain("vault=vault")
  })

  it("returns null on CLI failure", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "Error: not found", exitCode: 1 }),
    )

    expect(readVaultNote("missing/file")).toBeNull()
  })

  it("returns null on empty stdout", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "" }))

    expect(readVaultNote("empty/file")).toBeNull()
  })

  it("appends .md extension", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "content" }))

    readVaultNote("Plans/001/state")
    const cmd = spawnSyncSpy.mock.calls[0][0] as string[]
    expect(cmd).toContain("path=Plans/001/state.md")
  })
})

describe("readVaultProperty", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("returns property value on success", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "my-session-id" }),
    )

    const result = readVaultProperty("Plans/001/state", "session_id", "vault")
    expect(result).toBe("my-session-id")

    const cmd = spawnSyncSpy.mock.calls[0][0] as string[]
    expect(cmd).toContain("property:read")
    expect(cmd).toContain("name=session_id")
    expect(cmd).toContain("path=Plans/001/state.md")
  })

  it("returns null on failure", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "Error: no such property", exitCode: 1 }),
    )

    expect(readVaultProperty("Plans/001/state", "missing")).toBeNull()
  })

  it("returns null on empty stdout", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({ stdout: "" }))

    expect(readVaultProperty("Plans/001/state", "empty")).toBeNull()
  })
})

describe("setVaultProperty", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    spawnSyncSpy?.mockRestore()
  })

  it("passes correct CLI args and returns true on success", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(spawnSyncResult({}))

    const result = setVaultProperty("Plans/001/state", "session_id", "abc-123", "text", "vault")
    expect(result).toBe(true)

    const cmd = spawnSyncSpy.mock.calls[0][0] as string[]
    expect(cmd).toContain("property:set")
    expect(cmd).toContain("name=session_id")
    expect(cmd).toContain("value=abc-123")
    expect(cmd).toContain("type=text")
    expect(cmd).toContain("path=Plans/001/state.md")
    expect(cmd).toContain("vault=vault")
  })

  it("returns false on failure", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue(
      spawnSyncResult({ stdout: "Error: file not found", exitCode: 1 }),
    )

    expect(setVaultProperty("missing/file", "key", "val", "text")).toBe(false)
  })
})
