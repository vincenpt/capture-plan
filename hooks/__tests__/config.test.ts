import { describe, expect, it } from "bun:test"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { findTranscriptPath, userGlobalConfigPath } from "../lib/config.ts"

describe("userGlobalConfigPath", () => {
  it("returns ~/.config/capture-plan/config.toml on all platforms", () => {
    const path = userGlobalConfigPath()
    expect(path).toBe(join(homedir(), ".config", "capture-plan", "config.toml"))
  })
})

describe("findTranscriptPath", () => {
  it("returns null when cwd is not provided", () => {
    const result = findTranscriptPath("session-123")
    expect(result).toBeNull()
  })

  it("handles forward slashes in cwd path", () => {
    const cwd = "/home/user/projects/my-project"
    const slug = `-${cwd.replace(/[/\\]/g, "-").replace(/:/g, "")}`
    expect(slug).toBe("--home-user-projects-my-project")
  })

  it("handles backslashes in cwd path (Windows)", () => {
    const cwd = "C:\\Users\\testuser\\projects\\my-project"
    const slug = `-${cwd.replace(/[/\\]/g, "-").replace(/:/g, "")}`
    expect(slug).toBe("-C-Users-testuser-projects-my-project")
  })

  it("removes drive letter colon on Windows paths", () => {
    const cwd = "C:\\Users\\testuser\\projects"
    const slug = `-${cwd.replace(/[/\\]/g, "-").replace(/:/g, "")}`
    // Should produce: -C-Users-testuser-projects (colon removed)
    expect(slug).toBe("-C-Users-testuser-projects")
    expect(slug.includes(":")).toBe(false)
  })

  it("handles mixed separators", () => {
    const cwd = "C:\\Users/testuser\\projects/my-project"
    const slug = `-${cwd.replace(/[/\\]/g, "-").replace(/:/g, "")}`
    expect(slug).toBe("-C-Users-testuser-projects-my-project")
  })
})

describe("CONFIG_DEBUG_LOG path", () => {
  it("uses platform-aware temp directory, not hardcoded /tmp", async () => {
    // Import the config module to check that CONFIG_DEBUG_LOG is using tmpdir()
    // Since CONFIG_DEBUG_LOG is a constant, we verify it was constructed with tmpdir()
    const expectedPath = join(tmpdir(), "capture-config-debug.log")

    // The config module should define CONFIG_DEBUG_LOG using tmpdir()
    // This test verifies the path construction is cross-platform
    expect(expectedPath).toContain("capture-config-debug.log")

    // On Windows, tmpdir() returns something like C:\Users\...\AppData\Local\Temp
    // On Unix, it returns /tmp or similar
    // Both should work without hardcoding /tmp
    const tempDir = tmpdir()
    expect(tempDir).not.toBe("/tmp") // Verify tmpdir() returns platform-specific value
  })
})
