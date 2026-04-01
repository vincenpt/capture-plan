#!/usr/bin/env bun
// backport-journal.ts — Import plans from ~/.claude/plans/ into Obsidian vault + journal
// CLI script (not a hook). Run via: bun hooks/backport-journal.ts [options]

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  appendToJournal,
  type Config,
  createVaultNote,
  extractTitle,
  formatTagsYaml,
  getDatePartsFor,
  getJournalPathForDate,
  getProjectLabel,
  getProjectName,
  getVaultPath,
  loadConfig,
  mergeTagsOnDailyNote,
  nextCounter,
  padCounter,
  parsePlanFrontmatter,
  stripTitleLine,
  summarizeWithClaude,
  toSlug,
} from "./shared.ts";

/** Metadata for a plan file discovered in ~/.claude/plans/, including import status. */
export interface PlanInfo {
  sourceSlug: string; // e.g., "abundant-juggling-petal"
  sourcePath: string; // ~/.claude/plans/abundant-juggling-petal.md
  title: string; // First # heading
  date: string; // YYYY-MM-DD from file birthtime
  time: string; // HH:MM from file birthtime
  ampmTime: string; // "2:30 PM"
  projectCwd: string; // /Users/k/src/perforce/cto/p4c-backoffice
  projectLabel: string; // cto/p4c-backoffice
  isImported: boolean; // true if source_slug already in vault
}

/** Summary of a backport run: counts of scanned, skipped, and created plans plus any errors. */
export interface BackportResult {
  scanned: number;
  skipped: number;
  created: number;
  errors: string[];
  details: Array<{
    planDir: string;
    title: string;
    status: "created" | "skipped" | "error";
    reason?: string;
  }>;
}

interface CliArgs {
  list: boolean;
  all: boolean;
  from?: string;
  to?: string;
  plans?: string[]; // source slugs
  project?: string; // project label substring filter
  dryRun: boolean;
  skipSummarize: boolean;
  cwd?: string;
}

let PLANS_DIR = join(homedir(), ".claude", "plans");
let PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** @internal Test-only setter for plans directory */
export function _setPlansDirForTest(dir: string): void {
  PLANS_DIR = dir;
}

/** @internal Test-only setter for projects directory */
export function _setProjectsDirForTest(dir: string): void {
  PROJECTS_DIR = dir;
}

/** Parse CLI arguments into structured options for the backport command. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { list: false, all: false, dryRun: false, skipSummarize: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") args.list = true;
    else if (arg === "--all") args.all = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-summarize") args.skipSummarize = true;
    else if (arg.startsWith("--from=")) args.from = arg.slice(7);
    else if (arg.startsWith("--to=")) args.to = arg.slice(5);
    else if (arg.startsWith("--cwd=")) args.cwd = arg.slice(6);
    else if (arg.startsWith("--plans=")) args.plans = arg.slice(8).split(",");
    else if (arg.startsWith("--project=")) args.project = arg.slice(10);
  }
  return args;
}

/** Scan JSONL session files to build a map from plan slug to its originating project cwd. */
export function buildSlugProjectMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const dir of safeReaddir(PROJECTS_DIR)) {
    const dirPath = join(PROJECTS_DIR, dir);
    if (!isDir(dirPath)) continue;
    for (const file of safeReaddir(dirPath)) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const content = readFileSync(join(dirPath, file), "utf-8");
        for (const line of content.split("\n")) {
          if (!line.includes('"slug"')) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.slug && entry.cwd && !map.has(entry.slug)) {
              map.set(entry.slug, entry.cwd);
              break;
            }
          } catch {
            /* skip malformed lines */
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return map;
}

const PLAN_DIR_PATTERN = /^(\d{3,})-(.+)$/;
const DATE_DIR_PATTERN = /^(\d{2})-(\d{2})$/;
const YEAR_DIR_PATTERN = /^\d{4}$/;

/** Scan existing vault plan notes to collect source_slug values, used to deduplicate imports. */
export function getImportedSlugs(vaultPath: string, planPathRelative: string): Set<string> {
  const imported = new Set<string>();
  const basePath = join(vaultPath, planPathRelative);
  if (!existsSync(basePath)) return imported;

  for (const yearEntry of safeReaddir(basePath)) {
    if (!YEAR_DIR_PATTERN.test(yearEntry)) continue;
    const yearPath = join(basePath, yearEntry);
    if (!isDir(yearPath)) continue;
    for (const dateEntry of safeReaddir(yearPath)) {
      if (!DATE_DIR_PATTERN.test(dateEntry)) continue;
      const datePath = join(yearPath, dateEntry);
      if (!isDir(datePath)) continue;
      for (const planEntry of safeReaddir(datePath)) {
        if (!PLAN_DIR_PATTERN.test(planEntry)) continue;
        const planFile = join(datePath, planEntry, "plan.md");
        try {
          const content = readFileSync(planFile, "utf-8");
          const fm = parsePlanFrontmatter(content);
          if (fm.source_slug) imported.add(fm.source_slug);
        } catch {
          /* skip */
        }
      }
    }
  }
  return imported;
}

/** Discover all plan files in ~/.claude/plans/, resolving their project and import status. */
export function discoverPlans(
  vaultPath: string,
  planPathRelative: string,
  _config: Config,
): PlanInfo[] {
  const slugProjectMap = buildSlugProjectMap();
  const importedSlugs = getImportedSlugs(vaultPath, planPathRelative);

  const plans: PlanInfo[] = [];
  for (const file of safeReaddir(PLANS_DIR)) {
    if (!file.endsWith(".md") || file.includes("-agent-")) continue;

    const slug = file.replace(/\.md$/, "");
    const fullPath = join(PLANS_DIR, file);

    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const title = extractTitle(content);
    const stat = statSync(fullPath);
    const birthtime = stat.birthtime;
    const { dateKey, timeStr, ampmTime } = getDatePartsFor(birthtime);

    const cwd = slugProjectMap.get(slug) || "";

    plans.push({
      sourceSlug: slug,
      sourcePath: fullPath,
      title,
      date: dateKey,
      time: timeStr,
      ampmTime,
      projectCwd: cwd,
      projectLabel: getProjectLabel(cwd),
      isImported: importedSlugs.has(slug),
    });
  }

  plans.sort((a, b) => a.date.localeCompare(b.date) || a.sourceSlug.localeCompare(b.sourceSlug));
  return plans;
}

/** Apply date range, project, and slug filters to a list of discovered plans. */
export function filterPlans(plans: PlanInfo[], args: CliArgs): PlanInfo[] {
  let filtered = plans;

  if (args.from) {
    const from = args.from;
    filtered = filtered.filter((p) => p.date >= from);
  }
  if (args.to) {
    const to = args.to;
    filtered = filtered.filter((p) => p.date <= to);
  }
  if (args.project) {
    const proj = args.project.toLowerCase();
    filtered = filtered.filter((p) => p.projectLabel.toLowerCase().includes(proj));
  }
  if (args.plans) {
    const slugSet = new Set(args.plans);
    filtered = filtered.filter((p) => slugSet.has(p.sourceSlug));
  }

  return filtered;
}

const PLAN_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given an engineering plan, output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.
Line 2: 1-2 lowercase kebab-case tags relevant to the plan topic (comma-separated, no # prefix).
Output ONLY these two lines.`;

function fallbackSummary(content: string): string {
  return (
    content
      .replace(/^---[\s\S]*?---/, "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^(?:#+\s*|\|.*\|$|\s*[-*]\s+)/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "Captured from Claude Code session."
  );
}

/** Import selected plans into the Obsidian vault, creating notes and journal entries. Skips already-imported plans. */
export async function backportPlans(
  plans: PlanInfo[],
  vaultPath: string,
  config: Config,
  options: { dryRun: boolean; skipSummarize: boolean },
): Promise<BackportResult> {
  const result: BackportResult = {
    scanned: plans.length,
    skipped: 0,
    created: 0,
    errors: [],
    details: [],
  };

  for (const plan of plans) {
    if (plan.isImported) {
      result.skipped++;
      result.details.push({
        planDir: plan.sourceSlug,
        title: plan.title,
        status: "skipped",
        reason: "Already imported",
      });
      continue;
    }

    try {
      const content = readFileSync(plan.sourcePath, "utf-8");
      const title = plan.title;
      const slug = toSlug(title);
      const { dd, mm, yyyy } = getDatePartsFor(new Date(`${plan.date}T12:00:00`));
      const dateDirRelative = `${config.plan_path}/${yyyy}/${mm}-${dd}`;
      const dateDirAbsolute = join(vaultPath, dateDirRelative);
      const counter = nextCounter(dateDirAbsolute);

      const planDir = `${dateDirRelative}/${padCounter(counter)}-${slug}`;
      const planPath = `${planDir}/plan`;

      const birthtime = new Date(`${plan.date}T${plan.time || "12:00"}`);
      const journalPath = getJournalPathForDate(config, birthtime);
      const { datetime } = getDatePartsFor(birthtime);

      let summary: string;
      let tags: string;
      if (options.skipSummarize) {
        summary = fallbackSummary(content);
        tags = "claude-session";
      } else {
        const res = await summarizeWithClaude(content, PLAN_SYSTEM_PROMPT);
        summary = res.summary;
        tags = res.tags;
      }

      const project = getProjectName(plan.projectCwd);
      const tagsYaml = formatTagsYaml(tags);

      const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}
source_slug: ${plan.sourceSlug}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
---
# ${title}

${stripTitleLine(content)}
`;

      const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${planPath}\\|${plan.ampmTime || "Plan"}]] | ${summary} |`;

      if (!options.dryRun) {
        createVaultNote(planPath, noteContent, config.vault);
        appendToJournal(journalEntry, journalPath, config.vault);
        mergeTagsOnDailyNote(tags, journalPath, config.vault);
      }

      result.created++;
      result.details.push({
        planDir: plan.sourceSlug,
        title: plan.title,
        status: "created",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${plan.sourceSlug}: ${msg}`);
      result.details.push({
        planDir: plan.sourceSlug,
        title: plan.title,
        status: "error",
        reason: msg,
      });
    }
  }

  return result;
}

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.cwd);
  const vaultPath = getVaultPath(config.vault);

  if (!vaultPath) {
    console.error(
      JSON.stringify({ error: "Cannot resolve vault path. Check your capture-plan.toml config." }),
    );
    process.exit(1);
  }

  const plans = discoverPlans(vaultPath, config.plan_path, config);

  if (args.list) {
    const filtered = filterPlans(plans, args);
    console.log(JSON.stringify(filtered, null, 2));
    process.exit(0);
  }

  if (!args.all && !args.from && !args.to && !args.plans && !args.project) {
    console.error(
      JSON.stringify({
        error: "Specify --all, --from/--to, --project, or --plans to select plans for import.",
      }),
    );
    process.exit(1);
  }

  const selected = filterPlans(plans, args);
  const result = await backportPlans(selected, vaultPath, config, {
    dryRun: args.dryRun,
    skipSummarize: args.skipSummarize,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) main();
