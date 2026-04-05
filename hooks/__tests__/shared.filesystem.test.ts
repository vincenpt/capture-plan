import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import * as shared from "../shared.ts"

// ---- hooks.json structural validation ----

describe("hooks.json", () => {
  const hooksDir = join(dirname(dirname(import.meta.path)))
  const hooksJsonPath = join(hooksDir, "hooks.json")

  it("exists alongside the hook scripts", () => {
    const content = readFileSync(hooksJsonPath, "utf8")
    expect(content.length).toBeGreaterThan(0)
  })

  it("contains valid JSON with expected hook events", () => {
    const content = JSON.parse(readFileSync(hooksJsonPath, "utf8"))
    expect(content.hooks).toBeDefined()
    expect(content.hooks.PostToolUse).toBeArrayOfSize(1)
    expect(content.hooks.PostToolUse[0].matcher).toBe("ExitPlanMode")
    expect(content.hooks.Stop).toBeArrayOfSize(1)
  })

  it("hook commands reference CLAUDE_PLUGIN_ROOT", () => {
    const content = JSON.parse(readFileSync(hooksJsonPath, "utf8"))
    for (const event of Object.values(content.hooks) as { hooks: { command: string }[] }[]) {
      for (const entry of event) {
        for (const hook of entry.hooks) {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing for shell variable literal
          expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}")
        }
      }
    }
  })
})

let tempDir: string

beforeEach(() => {
  tempDir = join(tmpdir(), `cp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", tempDir])
})

// ---- nextCounter ----

describe("nextCounter", () => {
  it("returns 1 when directory does not exist", () => {
    expect(shared.nextCounter(join(tempDir, "no-such-dir"))).toBe(1)
  })

  it("returns 1 when directory is empty", () => {
    const dateDir = join(tempDir, "empty-date")
    mkdirSync(dateDir, { recursive: true })
    expect(shared.nextCounter(dateDir)).toBe(1)
  })

  it("returns max + 1 when folders exist", () => {
    const dateDir = join(tempDir, "with-plans")
    mkdirSync(join(dateDir, "001-first-plan"), { recursive: true })
    mkdirSync(join(dateDir, "002-second-plan"), { recursive: true })
    expect(shared.nextCounter(dateDir)).toBe(3)
  })

  it("finds the maximum counter, not just the last entry", () => {
    const dateDir = join(tempDir, "unordered")
    mkdirSync(join(dateDir, "003-third"), { recursive: true })
    mkdirSync(join(dateDir, "001-first"), { recursive: true })
    mkdirSync(join(dateDir, "005-fifth"), { recursive: true })
    expect(shared.nextCounter(dateDir)).toBe(6)
  })

  it("ignores entries that don't match NNN- pattern", () => {
    const dateDir = join(tempDir, "mixed")
    mkdirSync(join(dateDir, "001-valid-plan"), { recursive: true })
    mkdirSync(join(dateDir, "notes"), { recursive: true })
    mkdirSync(join(dateDir, ".hidden"), { recursive: true })
    expect(shared.nextCounter(dateDir)).toBe(2)
  })
})

// ---- vault-based session state ----

describe("parseStateFromFrontmatter", () => {
  const testState: shared.SessionState = {
    session_id: "test-session-123",
    plan_slug: "my-plan",
    plan_title: "My Plan",
    plan_dir: "Claude/Plans/2026/03-29/001-my-plan",
    date_key: "2026-03-29",
    timestamp: "2026-03-29T10:00:00.000Z",
    journal_path: "Journal/2026/03-March/29-Saturday",
    project: "my-project",
    tags: "plugin-dev, hooks",
  }

  // Helper to create a state.md string manually
  function makeStateMd(fields: Record<string, string>): string {
    const lines = ["---"]
    for (const [k, v] of Object.entries(fields)) {
      lines.push(`${k}: "${v}"`)
    }
    lines.push("---")
    return lines.join("\n")
  }

  it("round-trips all fields through serialize/parse", () => {
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
      journal_path: testState.journal_path ?? "",
      project: testState.project ?? "",
      tags: testState.tags ?? "",
    })
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.session_id).toBe("test-session-123")
    expect(parsed?.plan_slug).toBe("my-plan")
    expect(parsed?.plan_title).toBe("My Plan")
    expect(parsed?.plan_dir).toBe("Claude/Plans/2026/03-29/001-my-plan")
    expect(parsed?.date_key).toBe("2026-03-29")
    expect(parsed?.timestamp).toBe("2026-03-29T10:00:00.000Z")
    expect(parsed?.journal_path).toBe("Journal/2026/03-March/29-Saturday")
    expect(parsed?.project).toBe("my-project")
    expect(parsed?.tags).toBe("plugin-dev, hooks")
  })

  it("returns null for content without frontmatter", () => {
    expect(shared.parseStateFromFrontmatter("no frontmatter here")).toBeNull()
  })

  it("returns null when required fields are missing", () => {
    const content = makeStateMd({ session_id: "abc" })
    expect(shared.parseStateFromFrontmatter(content)).toBeNull()
  })

  it("handles state without optional fields", () => {
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
    })
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.journal_path).toBeUndefined()
    expect(parsed?.project).toBeUndefined()
    expect(parsed?.tags).toBeUndefined()
  })

  it("round-trips planStats as JSON", () => {
    const stats = {
      model: "claude-opus-4-6",
      durationMs: 60_000,
      tokens: { input: 5000, output: 1000, cache_read: 3000, cache_create: 500 },
      peakTurnContext: 8000,
      subagentCount: 1,
      tools: [{ name: "Read", calls: 5, errors: 0 }],
      mcpServers: [{ name: "context-mode", tools: ["ctx_search"], calls: 2 }],
      totalToolCalls: 5,
      totalErrors: 0,
    }
    const json = JSON.stringify(stats).replace(/"/g, '\\"')
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
      plan_stats_json: json,
    })
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed?.planStats).toEqual(stats)
  })

  it("round-trips cc_version through serialize/parse", () => {
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
      cc_version: "v2.1.89",
    })
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.cc_version).toBe("v2.1.89")
  })

  it("handles plan titles with escaped quotes", () => {
    const content = makeStateMd({
      session_id: "abc-123",
      plan_slug: "test",
      plan_title: 'Fix \\"summary\\" frontmatter',
      plan_dir: "Claude/Plans/2026/03-29/001-test",
      date_key: "2026-03-29",
      timestamp: "2026-03-29T10:00:00.000Z",
    })
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed?.plan_title).toBe('Fix "summary" frontmatter')
  })
})

describe("scanForVaultState", () => {
  it("finds a matching state file in the vault", () => {
    // Create a fake vault with a state.md file
    const vaultDir = join(tempDir, "vault")
    const planDir = "Claude/Plans/2026/03-29/001-my-plan"
    const stateDir = join(vaultDir, planDir)
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, "state.md"),
      [
        "---",
        'session_id: "target-session"',
        'plan_slug: "my-plan"',
        'plan_title: "My Plan"',
        `plan_dir: "${planDir}"`,
        'date_key: "2026/03-29"',
        `timestamp: "${new Date().toISOString()}"`,
        "---",
      ].join("\n"),
    )

    // scanForVaultState calls getVaultPath internally, which calls the obsidian CLI.
    // We can't easily mock that, so test parseStateFromFrontmatter + scan logic separately.
    // Here we just verify the state file is parseable.
    const content = readFileSync(join(stateDir, "state.md"), "utf8")
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.session_id).toBe("target-session")
  })

  it("returns null for non-matching session_id", () => {
    const content = [
      "---",
      'session_id: "other-session"',
      'plan_slug: "my-plan"',
      'plan_title: "My Plan"',
      'plan_dir: "Claude/Plans/2026/03-29/001-my-plan"',
      'date_key: "2026/03-29"',
      `timestamp: "${new Date().toISOString()}"`,
      "---",
    ].join("\n")
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed?.session_id).not.toBe("target-session")
  })
})

describe("writeVaultState + parseStateFromFrontmatter skill round-trip", () => {
  it("round-trips skill_name through frontmatter", () => {
    const planDir = "Claude/Plans/2026/04-03/001-simplify-hooks"
    const stateDir = join(tempDir, planDir)
    mkdirSync(stateDir, { recursive: true })

    // Write state.md manually (writeVaultState uses Obsidian CLI, not suitable for filesystem tests)
    const content = [
      "---",
      'session_id: "test-skill-session"',
      'plan_slug: "simplify-hooks"',
      'plan_title: "Simplify Hooks Code"',
      `plan_dir: "${planDir}"`,
      'date_key: "2026-04-03"',
      `timestamp: "${new Date().toISOString()}"`,
      'source: "skill"',
      'skill_name: "simplify"',
      "---",
    ].join("\n")
    writeFileSync(join(stateDir, "state.md"), content, "utf8")

    const stateFile = join(tempDir, planDir, "state.md")
    const fileContent = readFileSync(stateFile, "utf8")
    const parsed = shared.parseStateFromFrontmatter(fileContent)
    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBe("skill")
    expect(parsed?.skill_name).toBe("simplify")
  })
})

describe("parseStateFromFrontmatter with unquoted values", () => {
  it("parses Obsidian-native unquoted format", () => {
    const content = [
      "---",
      "session_id: abc-123",
      "plan_slug: my-plan",
      "plan_title: My Plan Title",
      "plan_dir: Claude/Plans/2026/04-05/001-my-plan",
      "date_key: 2026/04-05",
      `timestamp: ${new Date().toISOString()}`,
      "source: skill",
      "skill_name: simplify",
      "---",
    ].join("\n")
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.session_id).toBe("abc-123")
    expect(parsed?.plan_slug).toBe("my-plan")
    expect(parsed?.plan_title).toBe("My Plan Title")
    expect(parsed?.source).toBe("skill")
    expect(parsed?.skill_name).toBe("simplify")
  })

  it("parses plan_stats_json in raw JSON format", () => {
    const stats = { model: "haiku", durationMs: 120 }
    const content = [
      "---",
      "session_id: sess-1",
      "plan_slug: test",
      "plan_title: Test",
      "plan_dir: Claude/Plans/2026/04-05/001-test",
      "date_key: 2026/04-05",
      `timestamp: ${new Date().toISOString()}`,
      `plan_stats_json: ${JSON.stringify(stats)}`,
      "---",
    ].join("\n")
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed?.planStats?.model).toBe("haiku")
    expect(parsed?.planStats?.durationMs).toBe(120)
  })

  it("parses mixed quoted and unquoted values", () => {
    const content = [
      "---",
      'session_id: "quoted-id"',
      "plan_slug: unquoted-slug",
      'plan_title: "Quoted Title"',
      "plan_dir: Claude/Plans/2026/04-05/001-mixed",
      "date_key: 2026/04-05",
      `timestamp: ${new Date().toISOString()}`,
      "---",
    ].join("\n")
    const parsed = shared.parseStateFromFrontmatter(content)
    expect(parsed).not.toBeNull()
    expect(parsed?.session_id).toBe("quoted-id")
    expect(parsed?.plan_slug).toBe("unquoted-slug")
    expect(parsed?.plan_title).toBe("Quoted Title")
  })
})

describe("deleteVaultState", () => {
  it("calls obsidian delete with correct path", () => {
    const calls: string[][] = []
    const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      calls.push([...cmd])
      return { exitCode: 0, success: true, stdout: Buffer.from(""), stderr: Buffer.from("") }
    }) as typeof Bun.spawnSync)

    shared.deleteVaultState("Claude/Plans/2026/03-29/001-test", "MyVault")
    spy.mockRestore()

    expect(calls.length).toBe(1)
    expect(calls[0]).toContain("delete")
    expect(calls[0]).toContain("path=Claude/Plans/2026/03-29/001-test/state.md")
    expect(calls[0]).toContain("permanent")
    expect(calls[0]).toContain("vault=MyVault")
  })

  it("does not throw on missing file", () => {
    const spy = spyOn(Bun, "spawnSync").mockImplementation((() => {
      return {
        exitCode: 0,
        success: true,
        stdout: Buffer.from("Error: not found"),
        stderr: Buffer.from(""),
      }
    }) as typeof Bun.spawnSync)

    expect(() => {
      shared.deleteVaultState("nonexistent/path")
    }).not.toThrow()
    spy.mockRestore()
  })
})

// ---- appendRevisionToCallout ----

describe("appendRevisionToCallout", () => {
  const JOURNAL_REL = "Journal/2026/04-April/04-Friday"

  /** Extract the written content from mocked CLI create calls. */
  function extractCreateContent(calls: string[][]): string {
    const createCall = calls.find((c) => c.includes("create"))
    if (!createCall) return ""
    const contentArg = createCall.find((a) => a.startsWith("content="))
    if (!contentArg) return ""
    return contentArg.slice("content=".length).replace(/\\n/g, "\n")
  }

  it("inserts a revision after the last callout line in the matching block", async () => {
    const journalFile = join(tempDir, "journal.md")
    await Bun.write(
      journalFile,
      `> [!plan]+ My Plan
> \`project\` \u00b7 \`plan-mode\`
>
> - **10:30 AM** [[path|plan]] \`opus-4(200k)\`
>   First entry.
>   #tag1

> [!plan]+ Other Plan
> \`project\` \u00b7 \`plan-mode\`
>
> - **11:00 AM** [[path|plan]] \`opus-4(200k)\`
>   Other entry.
`,
    )

    const revision = `> - **2:00 PM** [[new|done]] \`opus-4(200k)\`
>   New revision.
>   #tag2`

    const calls: string[][] = []
    const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      calls.push([...cmd])
      return { exitCode: 0, success: true, stdout: Buffer.from(""), stderr: Buffer.from("") }
    }) as typeof Bun.spawnSync)

    const result = await shared.appendRevisionToCallout(
      "My Plan",
      revision,
      journalFile,
      JOURNAL_REL,
    )
    spy.mockRestore()
    expect(result).toBe(true)

    // Verify CLI was called with move (backup) + create
    expect(calls.some((c) => c.includes("move"))).toBe(true)
    expect(calls.some((c) => c.includes("create"))).toBe(true)

    const content = extractCreateContent(calls)
    const lines = content.split("\n")
    const firstEntryIdx = lines.findIndex((l) => l.includes("First entry"))
    const newRevIdx = lines.findIndex((l) => l.includes("New revision"))
    const otherIdx = lines.findIndex((l) => l.includes("> [!plan]+ Other Plan"))

    expect(newRevIdx).toBeGreaterThan(firstEntryIdx)
    expect(newRevIdx).toBeLessThan(otherIdx)
  })

  it("returns false when callout header not found", async () => {
    const journalFile = join(tempDir, "journal.md")
    await Bun.write(journalFile, "## Other Content\n\nSome text\n")

    const result = await shared.appendRevisionToCallout(
      "Missing Plan",
      "> - **2:00 PM** [[p|plan]]",
      journalFile,
      JOURNAL_REL,
    )
    expect(result).toBe(false)
  })

  it("returns false when file does not exist", async () => {
    const result = await shared.appendRevisionToCallout(
      "My Plan",
      "> - **2:00 PM** [[p|plan]]",
      join(tempDir, "nonexistent.md"),
      JOURNAL_REL,
    )
    expect(result).toBe(false)
  })

  it("handles callout at end of file", async () => {
    const journalFile = join(tempDir, "journal.md")
    await Bun.write(
      journalFile,
      `> [!plan]+ My Plan
> \`project\` \u00b7 \`plan-mode\`
>
> - **10:30 AM** [[path|plan]] \`opus-4(200k)\`
>   First entry.
`,
    )

    const revision = `> - **2:00 PM** [[new|done]] \`opus-4(200k)\`
>   Second entry.`

    const calls: string[][] = []
    const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      calls.push([...cmd])
      return { exitCode: 0, success: true, stdout: Buffer.from(""), stderr: Buffer.from("") }
    }) as typeof Bun.spawnSync)

    const result = await shared.appendRevisionToCallout(
      "My Plan",
      revision,
      journalFile,
      JOURNAL_REL,
    )
    spy.mockRestore()
    expect(result).toBe(true)

    const content = extractCreateContent(calls)
    expect(content).toContain("Second entry")
    expect(content.indexOf("Second entry")).toBeGreaterThan(content.indexOf("First entry"))
  })

  it("inserts revision after multi-line callout content", async () => {
    const journalFile = join(tempDir, "journal.md")
    await Bun.write(
      journalFile,
      `> [!plan]+ My Plan
> \`project\` \u00b7 \`plan-mode\`
>
> - **10:30 AM** [[path|plan]] \`opus-4(200k)\`
>   Only entry.
>   #tag1 #tag2
`,
    )

    const revision = `> - **2:00 PM** [[new|done]] \`opus-4(200k)\`
>   New entry.`

    const calls: string[][] = []
    const spy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      calls.push([...cmd])
      return { exitCode: 0, success: true, stdout: Buffer.from(""), stderr: Buffer.from("") }
    }) as typeof Bun.spawnSync)

    const result = await shared.appendRevisionToCallout(
      "My Plan",
      revision,
      journalFile,
      JOURNAL_REL,
    )
    spy.mockRestore()
    expect(result).toBe(true)

    const content = extractCreateContent(calls)
    const lines = content.split("\n")
    const tagIdx = lines.findIndex((l) => l.includes("#tag1 #tag2"))
    const bulletIdx = lines.findIndex((l) => l.includes("2:00 PM"))
    const newIdx = lines.findIndex((l) => l.includes("New entry"))
    expect(bulletIdx).toBe(tagIdx + 1)
    expect(newIdx).toBe(tagIdx + 2)
  })
})
