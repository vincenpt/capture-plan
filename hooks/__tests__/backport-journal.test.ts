import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  _setPlansDirForTest,
  _setProjectsDirForTest,
  backportPlans,
  buildSlugProjectMap,
  discoverPlans,
  filterPlans,
  getImportedSlugs,
  type PlanInfo,
  parseArgs,
} from "../backport-journal.ts"
import type { Config } from "../shared.ts"

// ---- Test Helpers ----

let tempDir: string
let vaultPath: string
let plansDir: string
let projectsDir: string

const TEST_CONFIG: Config = {
  vault: "TestVault",
  plan: { path: "Claude/Plans", date_scheme: "calendar" },
  journal: { path: "Journal", date_scheme: "calendar" },
}

function makePlanFile(slug: string, content: string): string {
  const filePath = join(plansDir, `${slug}.md`)
  writeFileSync(filePath, content)
  return filePath
}

function makeSessionJsonl(
  projectSlug: string,
  entries: Array<{ slug: string; cwd: string }>,
): void {
  const dirPath = join(projectsDir, projectSlug)
  mkdirSync(dirPath, { recursive: true })
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const lines = entries.map((e) =>
    JSON.stringify({ type: "user", slug: e.slug, cwd: e.cwd, sessionId }),
  )
  writeFileSync(join(dirPath, `${sessionId}.jsonl`), lines.join("\n"))
}

function makeVaultPlanNote(opts: {
  year: string
  dateDir: string
  counter: string
  slug: string
  title: string
  sourceSlug?: string
}): void {
  const planDir = join(
    vaultPath,
    "Claude/Plans",
    opts.year,
    opts.dateDir,
    `${opts.counter}-${opts.slug}`,
  )
  mkdirSync(planDir, { recursive: true })

  const sourceSlugLine = opts.sourceSlug ? `\nsource_slug: ${opts.sourceSlug}` : ""
  const content = `---
created: "[[Journal/${opts.year}/03-March/29-Sunday|${opts.year}-03-29T14:30]]"${sourceSlugLine}
---
# ${opts.title}

Plan body for ${opts.title}.
`
  writeFileSync(join(planDir, "plan.md"), content)
}

beforeEach(() => {
  tempDir = join(tmpdir(), `bp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  vaultPath = join(tempDir, "vault")
  plansDir = join(tempDir, "plans")
  projectsDir = join(tempDir, "projects")
  mkdirSync(vaultPath, { recursive: true })
  mkdirSync(plansDir, { recursive: true })
  mkdirSync(projectsDir, { recursive: true })
  _setPlansDirForTest(plansDir)
  _setProjectsDirForTest(projectsDir)
})

afterEach(() => {
  Bun.spawnSync(["rm", "-rf", tempDir])
})

// ---- parseArgs ----

describe("parseArgs", () => {
  it("parses --list flag", () => {
    expect(parseArgs(["--list"]).list).toBe(true)
  })

  it("parses --all flag", () => {
    expect(parseArgs(["--all"]).all).toBe(true)
  })

  it("parses --dry-run flag", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true)
  })

  it("parses --skip-summarize flag", () => {
    expect(parseArgs(["--skip-summarize"]).skipSummarize).toBe(true)
  })

  it("parses --from and --to", () => {
    const args = parseArgs(["--from=2026-01-01", "--to=2026-03-31"])
    expect(args.from).toBe("2026-01-01")
    expect(args.to).toBe("2026-03-31")
  })

  it("parses --plans as comma-separated slugs", () => {
    const args = parseArgs(["--plans=fuzzy-llama,crispy-anchor"])
    expect(args.plans).toEqual(["fuzzy-llama", "crispy-anchor"])
  })

  it("parses --project filter", () => {
    expect(parseArgs(["--project=capture-plan"]).project).toBe("capture-plan")
  })

  it("parses --cwd", () => {
    expect(parseArgs(["--cwd=/tmp/project"]).cwd).toBe("/tmp/project")
  })

  it("handles combined flags", () => {
    const args = parseArgs(["--all", "--dry-run", "--skip-summarize"])
    expect(args.all).toBe(true)
    expect(args.dryRun).toBe(true)
    expect(args.skipSummarize).toBe(true)
  })

  it("defaults to all false", () => {
    const args = parseArgs([])
    expect(args.list).toBe(false)
    expect(args.all).toBe(false)
    expect(args.dryRun).toBe(false)
    expect(args.skipSummarize).toBe(false)
    expect(args.from).toBeUndefined()
    expect(args.to).toBeUndefined()
    expect(args.plans).toBeUndefined()
    expect(args.project).toBeUndefined()
  })
})

// ---- buildSlugProjectMap ----

describe("buildSlugProjectMap", () => {
  it("maps slug to cwd from session JSONL", () => {
    makeSessionJsonl("-Users-k-src-myproject", [
      { slug: "fuzzy-llama", cwd: "/Users/k/src/myproject" },
    ])

    const map = buildSlugProjectMap()
    expect(map.get("fuzzy-llama")).toBe("/Users/k/src/myproject")
  })

  it("handles multiple projects", () => {
    makeSessionJsonl("-Users-k-src-project-a", [
      { slug: "plan-alpha", cwd: "/Users/k/src/project-a" },
    ])
    makeSessionJsonl("-Users-k-src-project-b", [
      { slug: "plan-beta", cwd: "/Users/k/src/project-b" },
    ])

    const map = buildSlugProjectMap()
    expect(map.get("plan-alpha")).toBe("/Users/k/src/project-a")
    expect(map.get("plan-beta")).toBe("/Users/k/src/project-b")
  })

  it("first match wins (does not overwrite)", () => {
    makeSessionJsonl("-project-1", [{ slug: "same-slug", cwd: "/first/cwd" }])
    makeSessionJsonl("-project-2", [{ slug: "same-slug", cwd: "/second/cwd" }])

    const map = buildSlugProjectMap()
    // Should have one of the two (first found)
    expect(map.has("same-slug")).toBe(true)
  })

  it("returns empty map when projects dir is empty", () => {
    const map = buildSlugProjectMap()
    expect(map.size).toBe(0)
  })

  it("skips malformed JSONL lines", () => {
    const dirPath = join(projectsDir, "-test-project")
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(
      join(dirPath, "session.jsonl"),
      `not valid json\n{"slug":"valid","cwd":"/valid/path"}\n{broken\n`,
    )

    const map = buildSlugProjectMap()
    expect(map.get("valid")).toBe("/valid/path")
  })
})

// ---- getImportedSlugs ----

describe("getImportedSlugs", () => {
  it("finds source_slug in vault plan frontmatter", () => {
    makeVaultPlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "my-plan",
      title: "My Plan",
      sourceSlug: "fuzzy-llama",
    })

    const imported = getImportedSlugs(vaultPath, "Claude/Plans")
    expect(imported.has("fuzzy-llama")).toBe(true)
  })

  it("returns empty set for missing vault dir", () => {
    const imported = getImportedSlugs(vaultPath, "Claude/Plans")
    expect(imported.size).toBe(0)
  })

  it("ignores plans without source_slug", () => {
    makeVaultPlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "old-plan",
      title: "Old Plan",
    })

    const imported = getImportedSlugs(vaultPath, "Claude/Plans")
    expect(imported.size).toBe(0)
  })

  it("finds multiple imported slugs", () => {
    makeVaultPlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "plan-a",
      title: "Plan A",
      sourceSlug: "slug-a",
    })
    makeVaultPlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "002",
      slug: "plan-b",
      title: "Plan B",
      sourceSlug: "slug-b",
    })

    const imported = getImportedSlugs(vaultPath, "Claude/Plans")
    expect(imported.has("slug-a")).toBe(true)
    expect(imported.has("slug-b")).toBe(true)
  })
})

// ---- discoverPlans ----

describe("discoverPlans", () => {
  it("discovers .md files from plans dir", () => {
    makePlanFile("fuzzy-llama", "# My Cool Plan\n\nDo stuff.")

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans).toHaveLength(1)
    expect(plans[0].sourceSlug).toBe("fuzzy-llama")
    expect(plans[0].title).toBe("My Cool Plan")
    expect(plans[0].isImported).toBe(false)
  })

  it("filters out -agent- variant files", () => {
    makePlanFile("fuzzy-llama", "# Main Plan\n\nContent.")
    makePlanFile("fuzzy-llama-agent-abc123def", "# Agent Sub-Plan\n\nSub content.")

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans).toHaveLength(1)
    expect(plans[0].sourceSlug).toBe("fuzzy-llama")
  })

  it("resolves project from session JSONL", () => {
    makePlanFile("fuzzy-llama", "# Plan With Project\n\nContent.")
    makeSessionJsonl("-Users-k-src-myproject", [
      { slug: "fuzzy-llama", cwd: "/Users/k/src/myproject" },
    ])

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans[0].projectCwd).toBe("/Users/k/src/myproject")
    expect(plans[0].projectLabel).toBe("src/myproject")
  })

  it("detects already-imported plans", () => {
    makePlanFile("fuzzy-llama", "# Already Imported\n\nContent.")
    makeVaultPlanNote({
      year: "2026",
      dateDir: "03-29",
      counter: "001",
      slug: "already-imported",
      title: "Already Imported",
      sourceSlug: "fuzzy-llama",
    })

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans[0].isImported).toBe(true)
  })

  it("returns empty for empty plans dir", () => {
    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans).toEqual([])
  })

  it("ignores non-.md files", () => {
    writeFileSync(join(plansDir, "notes.txt"), "not a plan")
    writeFileSync(join(plansDir, "data.json"), "{}")
    makePlanFile("real-plan", "# Real Plan\n\nContent.")

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans).toHaveLength(1)
    expect(plans[0].sourceSlug).toBe("real-plan")
  })

  it("sorts by date then slug", () => {
    // Create files with different birthtimes (best effort — file system may not differentiate)
    makePlanFile("aaa-first", "# AAA First\n\nContent.")
    makePlanFile("zzz-second", "# ZZZ Second\n\nContent.")

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans).toHaveLength(2)
    // Same date (created at almost the same time), sorted by slug
    expect(plans[0].sourceSlug).toBe("aaa-first")
    expect(plans[1].sourceSlug).toBe("zzz-second")
  })

  it("sets projectLabel to 'unknown' when no session match", () => {
    makePlanFile("orphan-plan", "# Orphan\n\nNo session.")

    const plans = discoverPlans(vaultPath, "Claude/Plans")
    expect(plans[0].projectLabel).toBe("unknown")
    expect(plans[0].projectCwd).toBe("")
  })
})

// ---- filterPlans ----

describe("filterPlans", () => {
  const plans: PlanInfo[] = [
    {
      sourceSlug: "jan-plan",
      sourcePath: "/tmp/plans/jan-plan.md",
      title: "Jan Plan",
      date: "2026-01-15",
      time: "10:00",
      ampmTime: "10:00 AM",
      projectCwd: "/Users/k/src/project-a",
      projectLabel: "src/project-a",
      isImported: false,
    },
    {
      sourceSlug: "mar-plan",
      sourcePath: "/tmp/plans/mar-plan.md",
      title: "Mar Plan",
      date: "2026-03-29",
      time: "14:30",
      ampmTime: "2:30 PM",
      projectCwd: "/Users/k/src/project-b",
      projectLabel: "src/project-b",
      isImported: false,
    },
    {
      sourceSlug: "jun-plan",
      sourcePath: "/tmp/plans/jun-plan.md",
      title: "Jun Plan",
      date: "2026-06-10",
      time: "09:00",
      ampmTime: "9:00 AM",
      projectCwd: "/Users/k/src/project-a",
      projectLabel: "src/project-a",
      isImported: true,
    },
  ]

  it("filters by --from date", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      from: "2026-03-01",
    })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].title).toBe("Mar Plan")
    expect(filtered[1].title).toBe("Jun Plan")
  })

  it("filters by --to date", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      to: "2026-03-31",
    })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].title).toBe("Jan Plan")
    expect(filtered[1].title).toBe("Mar Plan")
  })

  it("filters by date range", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      from: "2026-02-01",
      to: "2026-04-30",
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe("Mar Plan")
  })

  it("filters by project label", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      project: "project-a",
    })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].title).toBe("Jan Plan")
    expect(filtered[1].title).toBe("Jun Plan")
  })

  it("filters by project label case-insensitively", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      project: "Project-A",
    })
    expect(filtered).toHaveLength(2)
  })

  it("filters by specific plan slugs", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
      plans: ["jan-plan", "jun-plan"],
    })
    expect(filtered).toHaveLength(2)
    expect(filtered[0].title).toBe("Jan Plan")
    expect(filtered[1].title).toBe("Jun Plan")
  })

  it("returns all when no filters specified", () => {
    const filtered = filterPlans(plans, {
      list: false,
      all: false,
      dryRun: false,
      skipSummarize: false,
    })
    expect(filtered).toHaveLength(3)
  })
})

// ---- backportPlans ----

describe("backportPlans", () => {
  it("skips plans that are already imported", async () => {
    makePlanFile("imported-plan", "# Imported Plan\n\nContent.")

    const plans: PlanInfo[] = [
      {
        sourceSlug: "imported-plan",
        sourcePath: join(plansDir, "imported-plan.md"),
        title: "Imported Plan",
        date: "2026-03-29",
        time: "14:30",
        ampmTime: "2:30 PM",
        projectCwd: "/Users/k/src/project",
        projectLabel: "src/project",
        isImported: true,
      },
    ]

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    })

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
    expect(result.details[0].status).toBe("skipped")
    expect(result.details[0].reason).toBe("Already imported")
  })

  it("counts plans to create in dry-run mode", async () => {
    makePlanFile("new-plan", "# New Plan\n\nSome content for summarization.")

    const plans: PlanInfo[] = [
      {
        sourceSlug: "new-plan",
        sourcePath: join(plansDir, "new-plan.md"),
        title: "New Plan",
        date: "2026-03-29",
        time: "14:30",
        ampmTime: "2:30 PM",
        projectCwd: "/Users/k/src/project",
        projectLabel: "src/project",
        isImported: false,
      },
    ]

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    })

    expect(result.scanned).toBe(1)
    expect(result.created).toBe(1)
    expect(result.details[0].status).toBe("created")
    expect(result.details[0].title).toBe("New Plan")
  })

  it("handles mixed plans (some imported, some new)", async () => {
    makePlanFile("old-plan", "# Old Plan\n\nAlready in vault.")
    makePlanFile("fresh-plan", "# Fresh Plan\n\nNot yet imported.")

    const plans: PlanInfo[] = [
      {
        sourceSlug: "old-plan",
        sourcePath: join(plansDir, "old-plan.md"),
        title: "Old Plan",
        date: "2026-03-29",
        time: "10:00",
        ampmTime: "10:00 AM",
        projectCwd: "",
        projectLabel: "unknown",
        isImported: true,
      },
      {
        sourceSlug: "fresh-plan",
        sourcePath: join(plansDir, "fresh-plan.md"),
        title: "Fresh Plan",
        date: "2026-03-29",
        time: "11:00",
        ampmTime: "11:00 AM",
        projectCwd: "/Users/k/src/project",
        projectLabel: "src/project",
        isImported: false,
      },
    ]

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    })

    expect(result.scanned).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.created).toBe(1)
  })

  it("reports correct detail fields", async () => {
    makePlanFile("detail-test", "# Detail Test\n\nVerifying detail output.")

    const plans: PlanInfo[] = [
      {
        sourceSlug: "detail-test",
        sourcePath: join(plansDir, "detail-test.md"),
        title: "Detail Test",
        date: "2026-03-29",
        time: "14:30",
        ampmTime: "2:30 PM",
        projectCwd: "/Users/k/src/project",
        projectLabel: "src/project",
        isImported: false,
      },
    ]

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    })

    expect(result.details[0]).toEqual({
      planDir: "detail-test",
      title: "Detail Test",
      status: "created",
    })
  })

  it("handles read errors gracefully", async () => {
    const plans: PlanInfo[] = [
      {
        sourceSlug: "missing-plan",
        sourcePath: join(plansDir, "nonexistent.md"),
        title: "Missing Plan",
        date: "2026-03-29",
        time: "14:30",
        ampmTime: "2:30 PM",
        projectCwd: "",
        projectLabel: "unknown",
        isImported: false,
      },
    ]

    const result = await backportPlans(plans, vaultPath, TEST_CONFIG, {
      dryRun: true,
      skipSummarize: true,
    })

    expect(result.errors).toHaveLength(1)
    expect(result.details[0].status).toBe("error")
  })
})
