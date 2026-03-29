import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverPlans,
  filterPlans,
  backportPlans,
  checkJournalEntry,
  parseArgs,
  type PlanInfo,
} from "../backport-journal.ts";
import type { Config } from "../shared.ts";

// ---- Test Helpers ----

let tempDir: string;
let vaultPath: string;

const TEST_CONFIG: Config = {
  vault: "TestVault",
  plan_path: "Claude/Plans",
  journal_path: "Journal",
};

function makePlanNote(opts: {
  year: string;
  dateDir: string;
  counter: string;
  slug: string;
  title: string;
  journalPath?: string;
  datetime?: string;
  tags?: string[];
}): string {
  const planDir = join(
    vaultPath,
    "Claude/Plans",
    opts.year,
    opts.dateDir,
    `${opts.counter}-${opts.slug}`,
  );
  mkdirSync(planDir, { recursive: true });

  const jp = opts.journalPath || `Journal/${opts.year}/03-March/29-Sunday`;
  const dt = opts.datetime || `${opts.year}-${opts.dateDir.replace("-", "-")}T14:30`;
  const tags = opts.tags || ["plan", "claude-session"];
  const tagsYaml = tags.map((t) => `  - ${t}`).join("\n");

  const content = `---
created: "[[${jp}|${dt}]]"
status: planned
tags:
${tagsYaml}
source: Claude Code (Plan Mode)
session: test-session
counter: ${parseInt(opts.counter, 10)}
---
# ${opts.title}

This is the plan body for ${opts.title}.
`;

  writeFileSync(join(planDir, "plan.md"), content);
  return planDir;
}

function makeJournalFile(journalPath: string, content: string): void {
  const filePath = join(vaultPath, `${journalPath}.md`);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

beforeEach(() => {
  tempDir = join(
    tmpdir(),
    `bp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  vaultPath = join(tempDir, "vault");
  mkdirSync(vaultPath, { recursive: true });
});

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", tempDir]);
});

// ---- parseArgs ----

describe("parseArgs", () => {
  it("parses --list flag", () => {
    expect(parseArgs(["--list"]).list).toBe(true);
  });

  it("parses --all flag", () => {
    expect(parseArgs(["--all"]).all).toBe(true);
  });

  it("parses --dry-run flag", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  it("parses --skip-summarize flag", () => {
    expect(parseArgs(["--skip-summarize"]).skipSummarize).toBe(true);
  });

  it("parses --from and --to", () => {
    const args = parseArgs(["--from=2026-01-01", "--to=2026-03-31"]);
    expect(args.from).toBe("2026-01-01");
    expect(args.to).toBe("2026-03-31");
  });

  it("parses --plans as comma-separated list", () => {
    const args = parseArgs(["--plans=dir1,dir2,dir3"]);
    expect(args.plans).toEqual(["dir1", "dir2", "dir3"]);
  });

  it("parses --cwd", () => {
    expect(parseArgs(["--cwd=/tmp/project"]).cwd).toBe("/tmp/project");
  });

  it("handles combined flags", () => {
    const args = parseArgs(["--all", "--dry-run", "--skip-summarize"]);
    expect(args.all).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.skipSummarize).toBe(true);
  });

  it("defaults to all false", () => {
    const args = parseArgs([]);
    expect(args.list).toBe(false);
    expect(args.all).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.skipSummarize).toBe(false);
    expect(args.from).toBeUndefined();
    expect(args.to).toBeUndefined();
    expect(args.plans).toBeUndefined();
  });
});

// ---- discoverPlans ----

describe("discoverPlans", () => {
  it("discovers plans in the expected directory structure", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "my-plan",
      title: "My Plan",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("My Plan");
    expect(plans[0].planDir).toBe("Claude/Plans/2026/03-29/001-my-plan");
    expect(plans[0].planPath).toBe("Claude/Plans/2026/03-29/001-my-plan/plan");
    expect(plans[0].date).toBe("2026-03-29");
  });

  it("discovers multiple plans across different dates", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "plan-a",
      title: "Plan A",
      journalPath: "Journal/2026/03-March/29-Sunday",
      datetime: "2026-03-29T10:00",
    });
    makePlanNote({
      year: "2026",
      dateDir: "03-30",
      counter: "001",
      slug: "plan-b",
      title: "Plan B",
      journalPath: "Journal/2026/03-March/30-Monday",
      datetime: "2026-03-30T11:00",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toHaveLength(2);
    expect(plans[0].date).toBe("2026-03-29");
    expect(plans[1].date).toBe("2026-03-30");
  });

  it("discovers multiple plans on the same date", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "first",
      title: "First",
    });
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "002",
      slug: "second",
      title: "Second",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toHaveLength(2);
  });

  it("returns empty array when plan directory does not exist", () => {
    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toEqual([]);
  });

  it("ignores non-matching directories", () => {
    // Create some non-matching structure
    mkdirSync(join(vaultPath, "Claude/Plans/notes"), { recursive: true });
    mkdirSync(join(vaultPath, "Claude/Plans/2026/random"), { recursive: true });
    mkdirSync(join(vaultPath, "Claude/Plans/2026/03-29/no-counter"), {
      recursive: true,
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toEqual([]);
  });

  it("extracts journal path from frontmatter", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "test",
      title: "Test",
      journalPath: "Journal/2026/03-March/29-Sunday",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans[0].journalPath).toBe("Journal/2026/03-March/29-Sunday");
  });

  it("extracts time from frontmatter datetime", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "test",
      title: "Test",
      datetime: "2026-03-29T14:30",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans[0].time).toBe("14:30");
    expect(plans[0].ampmTime).toBe("2:30 PM");
  });

  it("handles plan without frontmatter", () => {
    const planDir = join(
      vaultPath,
      "Claude/Plans/2026/03-29/001-bare-plan",
    );
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "plan.md"),
      "# Bare Plan\n\nNo frontmatter here.",
    );

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("Bare Plan");
    expect(plans[0].date).toBe("2026-03-29");
  });

  it("sorts plans by date then directory", () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-30",
      counter: "001",
      slug: "later",
      title: "Later",
      datetime: "2026-03-30T10:00",
    });
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "earlier",
      title: "Earlier",
      datetime: "2026-03-29T10:00",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans[0].title).toBe("Earlier");
    expect(plans[1].title).toBe("Later");
  });
});

// ---- checkJournalEntry ----

describe("checkJournalEntry", () => {
  it("returns true when journal contains a link to the plan", () => {
    makeJournalFile("Journal/2026/03-March/29-Sunday", `### My Plan

| | |
|---|---|
| [[Claude/Plans/2026/03-29/001-my-plan/plan|2:30 PM]] | Summary |
`);

    expect(
      checkJournalEntry(
        vaultPath,
        "Journal/2026/03-March/29-Sunday",
        "Claude/Plans/2026/03-29/001-my-plan/plan",
      ),
    ).toBe(true);
  });

  it("returns false when journal does not contain the plan link", () => {
    makeJournalFile("Journal/2026/03-March/29-Sunday", `### Other Plan

| | |
|---|---|
| [[Claude/Plans/2026/03-29/002-other/plan|3:00 PM]] | Other |
`);

    expect(
      checkJournalEntry(
        vaultPath,
        "Journal/2026/03-March/29-Sunday",
        "Claude/Plans/2026/03-29/001-my-plan/plan",
      ),
    ).toBe(false);
  });

  it("returns false when journal file does not exist", () => {
    expect(
      checkJournalEntry(
        vaultPath,
        "Journal/2026/03-March/29-Sunday",
        "Claude/Plans/2026/03-29/001-my-plan/plan",
      ),
    ).toBe(false);
  });
});

// ---- filterPlans ----

describe("filterPlans", () => {
  const plans: PlanInfo[] = [
    {
      planDir: "Claude/Plans/2026/01-15/001-jan",
      planPath: "Claude/Plans/2026/01-15/001-jan/plan",
      title: "Jan Plan",
      date: "2026-01-15",
      time: "10:00",
      ampmTime: "10:00 AM",
      journalPath: "Journal/2026/01-January/15-Wednesday",
      tags: ["plan"],
      hasJournalEntry: false,
    },
    {
      planDir: "Claude/Plans/2026/03-29/001-mar",
      planPath: "Claude/Plans/2026/03-29/001-mar/plan",
      title: "Mar Plan",
      date: "2026-03-29",
      time: "14:30",
      ampmTime: "2:30 PM",
      journalPath: "Journal/2026/03-March/29-Sunday",
      tags: ["plan"],
      hasJournalEntry: false,
    },
    {
      planDir: "Claude/Plans/2026/06-10/001-jun",
      planPath: "Claude/Plans/2026/06-10/001-jun/plan",
      title: "Jun Plan",
      date: "2026-06-10",
      time: "09:00",
      ampmTime: "9:00 AM",
      journalPath: "Journal/2026/06-June/10-Wednesday",
      tags: ["plan"],
      hasJournalEntry: true,
    },
  ];

  it("filters by --from date", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      from: "2026-03-01",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].title).toBe("Mar Plan");
    expect(filtered[1].title).toBe("Jun Plan");
  });

  it("filters by --to date", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      to: "2026-03-31",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].title).toBe("Jan Plan");
    expect(filtered[1].title).toBe("Mar Plan");
  });

  it("filters by date range", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      from: "2026-02-01",
      to: "2026-04-30",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Mar Plan");
  });

  it("filters by specific plan dirs", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      plans: ["Claude/Plans/2026/01-15/001-jan", "Claude/Plans/2026/06-10/001-jun"],
    });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].title).toBe("Jan Plan");
    expect(filtered[1].title).toBe("Jun Plan");
  });

  it("returns all when no filters specified", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
    });
    expect(filtered).toHaveLength(3);
  });
});

// ---- backportPlans ----

describe("backportPlans", () => {
  it("skips plans that already have journal entries", async () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "existing",
      title: "Existing",
    });

    makeJournalFile("Journal/2026/03-March/29-Sunday", `### Existing

| | |
|---|---|
| [[Claude/Plans/2026/03-29/001-existing/plan|2:30 PM]] | Already here |
`);

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);
    expect(plans[0].hasJournalEntry).toBe(true);

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    });

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(result.details[0].status).toBe("skipped");
  });

  it("counts plans to create in dry-run mode", async () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "new-plan",
      title: "New Plan",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    });

    expect(result.scanned).toBe(1);
    expect(result.created).toBe(1);
    expect(result.details[0].status).toBe("created");
    expect(result.details[0].title).toBe("New Plan");
  });

  it("handles mixed plans (some with entries, some without)", async () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "has-entry",
      title: "Has Entry",
    });
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "002",
      slug: "no-entry",
      title: "No Entry",
    });

    makeJournalFile("Journal/2026/03-March/29-Sunday", `### Has Entry

| | |
|---|---|
| [[Claude/Plans/2026/03-29/001-has-entry/plan|2:30 PM]] | Already here |
`);

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    });

    expect(result.scanned).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
  });

  it("reports correct detail fields", async () => {
    makePlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "detail-test",
      title: "Detail Test",
    });

    const plans = discoverPlans(vaultPath, "Claude/Plans", TEST_CONFIG);

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    });

    expect(result.details[0]).toEqual({
      planDir: "Claude/Plans/2026/03-29/001-detail-test",
      title: "Detail Test",
      status: "created",
    });
  });
});
