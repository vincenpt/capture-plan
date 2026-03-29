import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as shared from "../shared.ts";
import { _setStateDirForTest } from "../shared.ts";

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
  it("returns 1 on first call", async () => {
    expect(await shared.nextCounter("2026-03-29")).toBe(1);
  });

  it("increments on subsequent calls", async () => {
    expect(await shared.nextCounter("2026-03-29")).toBe(1);
    expect(await shared.nextCounter("2026-03-29")).toBe(2);
    expect(await shared.nextCounter("2026-03-29")).toBe(3);
  });

  it("uses independent counters for different date keys", async () => {
    expect(await shared.nextCounter("2026-03-29")).toBe(1);
    expect(await shared.nextCounter("2026-03-30")).toBe(1);
    expect(await shared.nextCounter("2026-03-29")).toBe(2);
  });

  it("handles concurrent calls with unique values", async () => {
    const results = await Promise.all([
      shared.nextCounter("2026-03-29"),
      shared.nextCounter("2026-03-29"),
      shared.nextCounter("2026-03-29"),
      shared.nextCounter("2026-03-29"),
      shared.nextCounter("2026-03-29"),
    ]);
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---- writeSessionState / readSessionState / deleteSessionState ----

describe("session state", () => {
  const testState: shared.SessionState = {
    session_id: "test-session-123",
    plan_slug: "my-plan",
    plan_title: "My Plan",
    plan_dir: "Claude/Plans/2026/03-29/001-my-plan",
    counter: 1,
    date_key: "2026-03-29",
    timestamp: "2026-03-29T10:00:00.000Z",
    journal_path: "Journal/2026/03-March/29-Saturday",
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
    expect(read!.counter).toBe(1);
    expect(read!.date_key).toBe("2026-03-29");
    expect(read!.timestamp).toBe("2026-03-29T10:00:00.000Z");
    expect(read!.journal_path).toBe("Journal/2026/03-March/29-Saturday");
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
