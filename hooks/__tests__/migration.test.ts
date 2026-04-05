import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyDateEntry,
  cleanEmptyDirs,
  computeJournalMoves,
  computePlanMoves,
  detectVaultSchemes,
  executeMoves,
  parseDateFromPath,
} from "../lib/migration.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = join(import.meta.dir, `tmp-migration-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function mkdirs(...paths: string[]): void {
  for (const p of paths) {
    mkdirSync(join(tempDir, p), { recursive: true });
  }
}

function touch(...paths: string[]): void {
  for (const p of paths) {
    const full = join(tempDir, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "test");
  }
}

describe("classifyDateEntry", () => {
  it("classifies compact entries", () => {
    expect(classifyDateEntry("04-03")).toBe("compact");
    expect(classifyDateEntry("12-31")).toBe("compact");
  });

  it("classifies calendar entries", () => {
    expect(classifyDateEntry("04-April", ["03-Friday", "04-Saturday"])).toBe("calendar");
  });

  it("classifies monthly entries", () => {
    expect(classifyDateEntry("04-April", ["03", "04"])).toBe("monthly");
  });

  it("returns undefined for unrecognized entries", () => {
    expect(classifyDateEntry("random")).toBeUndefined();
    expect(classifyDateEntry("04-April")).toBeUndefined(); // no children
  });
});

describe("detectVaultSchemes", () => {
  it("detects compact scheme", () => {
    mkdirs("2026/04-03/001-test");
    const schemes = detectVaultSchemes(tempDir);
    expect(schemes.has("compact")).toBe(true);
    expect(schemes.size).toBe(1);
  });

  it("detects calendar scheme", () => {
    mkdirs("2026/04-April/03-Friday/001-test");
    const schemes = detectVaultSchemes(tempDir);
    expect(schemes.has("calendar")).toBe(true);
    expect(schemes.size).toBe(1);
  });

  it("detects monthly scheme", () => {
    mkdirs("2026/04-April/03/001-test");
    const schemes = detectVaultSchemes(tempDir);
    expect(schemes.has("monthly")).toBe(true);
    expect(schemes.size).toBe(1);
  });

  it("detects flat scheme", () => {
    mkdirs("2026-04-03/001-test");
    const schemes = detectVaultSchemes(tempDir);
    expect(schemes.has("flat")).toBe(true);
  });

  it("detects multiple schemes in mixed vault", () => {
    mkdirs("2026/04-03/001-test", "2026/04-April/04-Saturday/002-other");
    const schemes = detectVaultSchemes(tempDir);
    expect(schemes.has("compact")).toBe(true);
    expect(schemes.has("calendar")).toBe(true);
    expect(schemes.size).toBe(2);
  });

  it("returns empty set for non-existent path", () => {
    const schemes = detectVaultSchemes("/nonexistent/path");
    expect(schemes.size).toBe(0);
  });
});

describe("parseDateFromPath", () => {
  it("parses compact date", () => {
    const date = parseDateFromPath("compact", "2026", ["04-03"]);
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(3); // April (0-indexed)
    expect(date?.getDate()).toBe(3);
  });

  it("parses calendar date", () => {
    const date = parseDateFromPath("calendar", "2026", ["04-April", "03-Friday"]);
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(3);
    expect(date?.getDate()).toBe(3);
  });

  it("parses monthly date", () => {
    const date = parseDateFromPath("monthly", "2026", ["04-April", "03"]);
    expect(date).not.toBeNull();
    expect(date?.getMonth()).toBe(3);
    expect(date?.getDate()).toBe(3);
  });

  it("parses flat date", () => {
    const date = parseDateFromPath("flat", "", ["2026-04-03"]);
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(3);
    expect(date?.getDate()).toBe(3);
  });
});

describe("computePlanMoves", () => {
  it("computes moves from compact to calendar", () => {
    mkdirs("2026/04-03/001-test-plan");
    const moves = computePlanMoves(tempDir, "compact", "calendar");
    expect(moves.length).toBe(1);
    expect(moves[0].from).toContain("04-03/001-test-plan");
    expect(moves[0].to).toContain("04-April/03-Friday/001-test-plan");
  });

  it("returns empty for same scheme", () => {
    mkdirs("2026/04-03/001-test");
    const moves = computePlanMoves(tempDir, "compact", "compact");
    expect(moves.length).toBe(0);
  });

  it("handles multiple plans in one day", () => {
    mkdirs("2026/04-03/001-first", "2026/04-03/002-second");
    const moves = computePlanMoves(tempDir, "compact", "calendar");
    expect(moves.length).toBe(2);
  });

  it("computes moves from calendar to compact", () => {
    mkdirs("2026/04-April/03-Friday/001-test-plan");
    const moves = computePlanMoves(tempDir, "calendar", "compact");
    expect(moves.length).toBe(1);
    expect(moves[0].to).toContain("04-03/001-test-plan");
  });

  it("computes moves from flat to calendar", () => {
    mkdirs("2026-04-03/001-test-plan");
    const moves = computePlanMoves(tempDir, "flat", "calendar");
    expect(moves.length).toBe(1);
    expect(moves[0].from).toContain("2026-04-03/001-test-plan");
    expect(moves[0].to).toContain("04-April/03-Friday/001-test-plan");
  });

  it("computes moves from calendar to flat", () => {
    mkdirs("2026/04-April/03-Friday/001-test-plan");
    const moves = computePlanMoves(tempDir, "calendar", "flat");
    expect(moves.length).toBe(1);
    expect(moves[0].to).toContain("2026-04-03/001-test-plan");
  });
});

describe("computeJournalMoves", () => {
  it("computes moves from compact to calendar", () => {
    touch("2026/03-29.md");
    const moves = computeJournalMoves(tempDir, "compact", "calendar");
    expect(moves.length).toBe(1);
    expect(moves[0].from).toContain("03-29.md");
    expect(moves[0].to).toContain("03-March/29-Sunday.md");
  });

  it("computes moves from calendar to compact", () => {
    touch("2026/03-March/29-Sunday.md");
    const moves = computeJournalMoves(tempDir, "calendar", "compact");
    expect(moves.length).toBe(1);
    expect(moves[0].to).toContain("03-29.md");
  });

  it("returns empty for same scheme", () => {
    touch("2026/03-March/29-Sunday.md");
    const moves = computeJournalMoves(tempDir, "calendar", "calendar");
    expect(moves.length).toBe(0);
  });
});

describe("executeMoves", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Mock Bun.spawnSync to simulate Obsidian CLI move/delete via filesystem
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockImplementation(((cmd: string[]) => {
      const pathArg = cmd.find((a: string) => a.startsWith("path="))?.slice(5);
      if (cmd.includes("move")) {
        const toArg = cmd.find((a: string) => a.startsWith("to="))?.slice(3);
        if (pathArg && toArg) {
          const absFrom = join(tempDir, pathArg);
          const absTo = join(tempDir, toArg);
          mkdirSync(join(absTo, ".."), { recursive: true });
          renameSync(absFrom, absTo);
        }
      } else if (cmd.includes("delete") && pathArg) {
        const abs = join(tempDir, pathArg);
        try {
          rmSync(abs, { recursive: true });
        } catch {
          /* ignore */
        }
      }
      return { exitCode: 0, success: true, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }) as typeof Bun.spawnSync);
  });

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
  });

  it("moves directories to new locations", () => {
    const from = join(tempDir, "src/001-test");
    const to = join(tempDir, "dst/001-test");
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, "plan.md"), "test");

    const count = executeMoves([{ from, to, type: "plan-dir" }], tempDir);
    expect(count).toBe(1);
    expect(readdirSync(to)).toContain("plan.md");
  });

  it("skips moves where from equals to", () => {
    const path = join(tempDir, "same/001-test");
    mkdirSync(path, { recursive: true });
    const count = executeMoves([{ from: path, to: path, type: "plan-dir" }], tempDir);
    expect(count).toBe(0);
  });
});

describe("cleanEmptyDirs", () => {
  it("removes empty parent directories", () => {
    const deep = join(tempDir, "a/b/c");
    mkdirSync(deep, { recursive: true });
    const removed = cleanEmptyDirs([join(deep, "file.txt")], tempDir);
    expect(removed).toBe(3); // c, b, a
  });

  it("stops at non-empty directories", () => {
    const deep = join(tempDir, "a/b/c");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(tempDir, "a/keep.txt"), "keep");
    const removed = cleanEmptyDirs([join(deep, "file.txt")], tempDir);
    expect(removed).toBe(2); // c, b — stops at a because it has keep.txt
  });

  it("stops at basePath", () => {
    const removed = cleanEmptyDirs([join(tempDir, "file.txt")], tempDir);
    expect(removed).toBe(0);
  });
});
