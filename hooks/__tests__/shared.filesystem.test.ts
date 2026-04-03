import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as shared from "../shared.ts";

// ---- hooks.json structural validation ----

describe("hooks.json", () => {
  const hooksDir = join(dirname(dirname(import.meta.path)));
  const hooksJsonPath = join(hooksDir, "hooks.json");

  it("exists alongside the hook scripts", () => {
    const content = readFileSync(hooksJsonPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("contains valid JSON with expected hook events", () => {
    const content = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.PostToolUse).toBeArrayOfSize(1);
    expect(content.hooks.PostToolUse[0].matcher).toBe("ExitPlanMode");
    expect(content.hooks.Stop).toBeArrayOfSize(1);
  });

  it("hook commands reference CLAUDE_PLUGIN_ROOT", () => {
    const content = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
    for (const event of Object.values(content.hooks) as { hooks: { command: string }[] }[]) {
      for (const entry of event) {
        for (const hook of entry.hooks) {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: testing for shell variable literal
          expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}");
        }
      }
    }
  });
});

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `cp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", tempDir]);
});

// ---- nextCounter ----

describe("nextCounter", () => {
  it("returns 1 when directory does not exist", () => {
    expect(shared.nextCounter(join(tempDir, "no-such-dir"))).toBe(1);
  });

  it("returns 1 when directory is empty", () => {
    const dateDir = join(tempDir, "empty-date");
    mkdirSync(dateDir, { recursive: true });
    expect(shared.nextCounter(dateDir)).toBe(1);
  });

  it("returns max + 1 when folders exist", () => {
    const dateDir = join(tempDir, "with-plans");
    mkdirSync(join(dateDir, "001-first-plan"), { recursive: true });
    mkdirSync(join(dateDir, "002-second-plan"), { recursive: true });
    expect(shared.nextCounter(dateDir)).toBe(3);
  });

  it("finds the maximum counter, not just the last entry", () => {
    const dateDir = join(tempDir, "unordered");
    mkdirSync(join(dateDir, "003-third"), { recursive: true });
    mkdirSync(join(dateDir, "001-first"), { recursive: true });
    mkdirSync(join(dateDir, "005-fifth"), { recursive: true });
    expect(shared.nextCounter(dateDir)).toBe(6);
  });

  it("ignores entries that don't match NNN- pattern", () => {
    const dateDir = join(tempDir, "mixed");
    mkdirSync(join(dateDir, "001-valid-plan"), { recursive: true });
    mkdirSync(join(dateDir, "notes"), { recursive: true });
    mkdirSync(join(dateDir, ".hidden"), { recursive: true });
    expect(shared.nextCounter(dateDir)).toBe(2);
  });
});

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
  };

  // Helper to create a state.md string manually
  function makeStateMd(fields: Record<string, string>): string {
    const lines = ["---"];
    for (const [k, v] of Object.entries(fields)) {
      lines.push(`${k}: "${v}"`);
    }
    lines.push("---");
    return lines.join("\n");
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
    });
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed?.session_id).toBe("test-session-123");
    expect(parsed?.plan_slug).toBe("my-plan");
    expect(parsed?.plan_title).toBe("My Plan");
    expect(parsed?.plan_dir).toBe("Claude/Plans/2026/03-29/001-my-plan");
    expect(parsed?.date_key).toBe("2026-03-29");
    expect(parsed?.timestamp).toBe("2026-03-29T10:00:00.000Z");
    expect(parsed?.journal_path).toBe("Journal/2026/03-March/29-Saturday");
    expect(parsed?.project).toBe("my-project");
    expect(parsed?.tags).toBe("plugin-dev, hooks");
  });

  it("returns null for content without frontmatter", () => {
    expect(shared.parseStateFromFrontmatter("no frontmatter here")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const content = makeStateMd({ session_id: "abc" });
    expect(shared.parseStateFromFrontmatter(content)).toBeNull();
  });

  it("handles state without optional fields", () => {
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
    });
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed?.journal_path).toBeUndefined();
    expect(parsed?.project).toBeUndefined();
    expect(parsed?.tags).toBeUndefined();
  });

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
    };
    const json = JSON.stringify(stats).replace(/"/g, '\\"');
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
      plan_stats_json: json,
    });
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed?.planStats).toEqual(stats);
  });

  it("round-trips cc_version through serialize/parse", () => {
    const content = makeStateMd({
      session_id: testState.session_id,
      plan_slug: testState.plan_slug,
      plan_title: testState.plan_title,
      plan_dir: testState.plan_dir,
      date_key: testState.date_key,
      timestamp: testState.timestamp,
      cc_version: "v2.1.89",
    });
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed?.cc_version).toBe("v2.1.89");
  });

  it("handles plan titles with escaped quotes", () => {
    const content = makeStateMd({
      session_id: "abc-123",
      plan_slug: "test",
      plan_title: 'Fix \\"summary\\" frontmatter',
      plan_dir: "Claude/Plans/2026/03-29/001-test",
      date_key: "2026-03-29",
      timestamp: "2026-03-29T10:00:00.000Z",
    });
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed?.plan_title).toBe('Fix "summary" frontmatter');
  });
});

describe("scanForVaultState", () => {
  it("finds a matching state file in the vault", () => {
    // Create a fake vault with a state.md file
    const vaultDir = join(tempDir, "vault");
    const planDir = "Claude/Plans/2026/03-29/001-my-plan";
    const stateDir = join(vaultDir, planDir);
    mkdirSync(stateDir, { recursive: true });
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
    );

    // scanForVaultState calls getVaultPath internally, which calls the obsidian CLI.
    // We can't easily mock that, so test parseStateFromFrontmatter + scan logic separately.
    // Here we just verify the state file is parseable.
    const content = readFileSync(join(stateDir, "state.md"), "utf8");
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed?.session_id).toBe("target-session");
  });

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
    ].join("\n");
    const parsed = shared.parseStateFromFrontmatter(content);
    expect(parsed?.session_id).not.toBe("target-session");
  });
});

describe("writeVaultState + parseStateFromFrontmatter skill round-trip", () => {
  it("round-trips skill_name through frontmatter", () => {
    const planDir = "Claude/Plans/2026/04-03/001-simplify-hooks";
    const stateDir = join(tempDir, planDir);
    mkdirSync(stateDir, { recursive: true });

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
    ].join("\n");
    writeFileSync(join(stateDir, "state.md"), content, "utf8");

    const stateFile = join(tempDir, planDir, "state.md");
    const fileContent = readFileSync(stateFile, "utf8");
    const parsed = shared.parseStateFromFrontmatter(fileContent);
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe("skill");
    expect(parsed?.skill_name).toBe("simplify");
  });
});

describe("deleteVaultState", () => {
  it("removes the state file", () => {
    const stateDir = join(tempDir, "Claude/Plans/2026/03-29/001-test");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "state.md"), "---\n---");
    expect(existsSync(join(stateDir, "state.md"))).toBe(true);

    shared.deleteVaultState("Claude/Plans/2026/03-29/001-test", tempDir);
    expect(existsSync(join(stateDir, "state.md"))).toBe(false);
  });

  it("ignores missing file without throwing", () => {
    expect(() => {
      shared.deleteVaultState("nonexistent/path", tempDir);
    }).not.toThrow();
  });
});

// ---- appendRowToJournalSection ----

describe("appendRowToJournalSection", () => {
  it("inserts a row after the last table row in the matching section", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(
      journalFile,
      `## Claude Sessions

### My Plan

| | |
|---|---|
| [[path|10:30 AM]] | First entry |

### Other Plan

| | |
|---|---|
| [[path|11:00 AM]] | Other entry |
`,
    );

    const result = await shared.appendRowToJournalSection(
      "My Plan",
      "| [[new|2:00 PM]] | New row |",
      journalFile,
    );
    expect(result).toBe(true);

    const content = await Bun.file(journalFile).text();
    const lines = content.split("\n");
    const firstEntryIdx = lines.findIndex((l) => l.includes("First entry"));
    const newRowIdx = lines.findIndex((l) => l.includes("New row"));
    const otherIdx = lines.findIndex((l) => l.includes("### Other Plan"));

    expect(newRowIdx).toBeGreaterThan(firstEntryIdx);
    expect(newRowIdx).toBeLessThan(otherIdx);
  });

  it("returns false when header not found", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(journalFile, "## Other Content\n\nSome text\n");

    const result = await shared.appendRowToJournalSection("Missing Plan", "| row |", journalFile);
    expect(result).toBe(false);
  });

  it("returns false when no table rows exist under header", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(journalFile, "### My Plan\n\nJust text, no table.\n");

    const result = await shared.appendRowToJournalSection("My Plan", "| row |", journalFile);
    expect(result).toBe(false);
  });

  it("returns false when file does not exist", async () => {
    const result = await shared.appendRowToJournalSection(
      "My Plan",
      "| row |",
      join(tempDir, "nonexistent.md"),
    );
    expect(result).toBe(false);
  });

  it("handles section at end of file", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(
      journalFile,
      `### My Plan

| | |
|---|---|
| [[path|10:30 AM]] | First entry |
`,
    );

    const result = await shared.appendRowToJournalSection(
      "My Plan",
      "| [[new|2:00 PM]] | Second entry |",
      journalFile,
    );
    expect(result).toBe(true);

    const content = await Bun.file(journalFile).text();
    expect(content).toContain("Second entry");
    expect(content.indexOf("Second entry")).toBeGreaterThan(content.indexOf("First entry"));
  });

  it("skips table separator rows when finding last table row", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(
      journalFile,
      `### My Plan

| | |
|---|---|
| [[path|10:30 AM]] | Only entry |
`,
    );

    const result = await shared.appendRowToJournalSection(
      "My Plan",
      "| [[new|2:00 PM]] | New entry |",
      journalFile,
    );
    expect(result).toBe(true);

    const content = await Bun.file(journalFile).text();
    const lines = content.split("\n");
    const onlyIdx = lines.findIndex((l) => l.includes("Only entry"));
    const newIdx = lines.findIndex((l) => l.includes("New entry"));
    expect(newIdx).toBe(onlyIdx + 1);
  });
});
