import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTomlValue } from "../shared.ts"

const TEST_DIR = join(tmpdir(), `toml-writer-test-${Date.now()}`)

function testFile(name: string): string {
  return join(TEST_DIR, name)
}

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe("setTomlValue", () => {
  it("creates a new file with table and key when file does not exist", () => {
    const path = testFile("new.toml")
    setTomlValue(path, "session", "enabled", true)
    expect(readFileSync(path, "utf8")).toBe("[session]\nenabled = true\n")
  })

  it("creates parent directories if needed", () => {
    const path = join(TEST_DIR, "deep", "nested", "config.toml")
    setTomlValue(path, "session", "enabled", false)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf8")).toContain("enabled = false")
  })

  it("appends a new table to an existing file", () => {
    const path = testFile("existing.toml")
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(path, `vault = "Personal"\n\n[plan]\npath = "Claude/Plans"\n`)

    setTomlValue(path, "session", "enabled", true)
    const content = readFileSync(path, "utf8")
    expect(content).toContain(`vault = "Personal"`)
    expect(content).toContain("[plan]")
    expect(content).toContain("[session]\nenabled = true")
  })

  it("adds a key to an existing table that lacks it", () => {
    const path = testFile("add-key.toml")
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(path, `[session]\npath = "Claude/Sessions"\n`)

    setTomlValue(path, "session", "enabled", true)
    const content = readFileSync(path, "utf8")
    expect(content).toContain(`path = "Claude/Sessions"`)
    expect(content).toContain("enabled = true")
  })

  it("updates an existing key in a table", () => {
    const path = testFile("update.toml")
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(path, `[session]\nenabled = false\npath = "Claude/Sessions"\n`)

    setTomlValue(path, "session", "enabled", true)
    const content = readFileSync(path, "utf8")
    expect(content).toContain("enabled = true")
    expect(content).not.toContain("enabled = false")
    expect(content).toContain(`path = "Claude/Sessions"`)
  })

  it("preserves other tables and comments", () => {
    const path = testFile("preserve.toml")
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(
      path,
      `# Main config\nvault = "Personal"\n\n[plan]\npath = "Claude/Plans"\n\n[session]\npath = "Claude/Sessions"\n`,
    )

    setTomlValue(path, "session", "enabled", true)
    const content = readFileSync(path, "utf8")
    expect(content).toContain("# Main config")
    expect(content).toContain(`vault = "Personal"`)
    expect(content).toContain("[plan]")
    expect(content).toContain(`path = "Claude/Plans"`)
    expect(content).toContain("[session]")
    expect(content).toContain("enabled = true")
  })

  it("handles number values", () => {
    const path = testFile("number.toml")
    setTomlValue(path, "session", "prompt_max_chars", 500)
    expect(readFileSync(path, "utf8")).toContain("prompt_max_chars = 500")
  })

  it("handles string values with proper quoting", () => {
    const path = testFile("string.toml")
    setTomlValue(path, "session", "path", "Claude/Sessions")
    expect(readFileSync(path, "utf8")).toContain(`path = "Claude/Sessions"`)
  })

  it("handles a table followed by another table", () => {
    const path = testFile("multi-table.toml")
    mkdirSync(TEST_DIR, { recursive: true })
    writeFileSync(path, `[session]\npath = "Claude/Sessions"\n\n[journal]\npath = "Journal"\n`)

    setTomlValue(path, "session", "enabled", true)
    const content = readFileSync(path, "utf8")
    expect(content).toContain("[session]")
    expect(content).toContain("enabled = true")
    expect(content).toContain("[journal]")
    expect(content).toContain(`path = "Journal"`)
  })
})
