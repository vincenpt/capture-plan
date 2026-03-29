import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import * as shared from "../shared.ts";
import { _setStateDirForTest } from "../shared.ts";

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
    for (const event of Object.values(content.hooks) as any[]) {
      for (const entry of event) {
        for (const hook of entry.hooks) {
          expect(hook.command).toContain("${CLAUDE_PLUGIN_ROOT}");
        }
      }
    }
  });
});

let tempDir: string;
let originalStateDir: string;

beforeEach(() => {
  tempDir = join(
    tmpdir(),
    `cp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempDir, { recursive: true });
  originalStateDir = shared.STATE_DIR;
  _setStateDirForTest(tempDir);
});

afterEach(() => {
  _setStateDirForTest(originalStateDir);
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

// ---- writeSessionState / readSessionState / deleteSessionState ----

describe("session state", () => {
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

  it("writes and reads back the same state", async () => {
    await shared.writeSessionState("test-session-123", testState);
    const read = await shared.readSessionState("test-session-123");
    expect(read).toEqual(testState);
  });

  it("returns null for non-existent session", async () => {
    const read = await shared.readSessionState("does-not-exist");
    expect(read).toBeNull();
  });

  it("deletes session state", async () => {
    await shared.writeSessionState("test-session-123", testState);
    shared.deleteSessionState("test-session-123");
    const read = await shared.readSessionState("test-session-123");
    expect(read).toBeNull();
  });

  it("preserves all fields", async () => {
    await shared.writeSessionState("test-session-123", testState);
    const read = await shared.readSessionState("test-session-123");
    expect(read!.session_id).toBe("test-session-123");
    expect(read!.plan_slug).toBe("my-plan");
    expect(read!.plan_title).toBe("My Plan");
    expect(read!.plan_dir).toBe("Claude/Plans/2026/03-29/001-my-plan");
    expect(read!.date_key).toBe("2026-03-29");
    expect(read!.timestamp).toBe("2026-03-29T10:00:00.000Z");
    expect(read!.journal_path).toBe("Journal/2026/03-March/29-Saturday");
    expect(read!.project).toBe("my-project");
    expect(read!.tags).toBe("plugin-dev, hooks");
  });

  it("handles state without optional journal_path", async () => {
    const stateNoJournal = { ...testState, journal_path: undefined };
    await shared.writeSessionState("no-journal", stateNoJournal);
    const read = await shared.readSessionState("no-journal");
    expect(read!.journal_path).toBeUndefined();
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

    const result = await shared.appendRowToJournalSection(
      "Missing Plan",
      "| row |",
      journalFile,
    );
    expect(result).toBe(false);
  });

  it("returns false when no table rows exist under header", async () => {
    const journalFile = join(tempDir, "journal.md");
    await Bun.write(journalFile, "### My Plan\n\nJust text, no table.\n");

    const result = await shared.appendRowToJournalSection(
      "My Plan",
      "| row |",
      journalFile,
    );
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
    expect(content.indexOf("Second entry")).toBeGreaterThan(
      content.indexOf("First entry"),
    );
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
