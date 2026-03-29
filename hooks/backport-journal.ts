#!/usr/bin/env bun
// backport-journal.ts — Retroactively create journal entries for existing plans
// CLI script (not a hook). Run via: bun hooks/backport-journal.ts [options]

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  loadConfig,
  getVaultPath,
  extractTitle,
  parsePlanFrontmatter,
  summarizeWithClaude,
  formatAmPm,
  getJournalPathForDate,
  getDatePartsFor,
  appendToJournal,
  mergeTagsOnDailyNote,
  type Config,
  type PlanFrontmatter,
} from "./shared.ts";

// ---- Types ----

export interface PlanInfo {
  planDir: string;        // Relative to vault: Claude/Plans/2026/03-29/001-slug
  planPath: string;       // planDir + /plan (the note path without .md)
  title: string;
  date: string;           // YYYY-MM-DD
  time: string;           // HH:MM or empty
  ampmTime: string;       // "2:30 PM" or empty
  journalPath: string;    // Journal/2026/03-March/29-Sunday
  tags: string[];
  hasJournalEntry: boolean;
}

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
  plans?: string[];
  dryRun: boolean;
  skipSummarize: boolean;
  cwd?: string;
}

// ---- CLI Argument Parsing ----

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
  }
  return args;
}

// ---- Plan Discovery ----

const PLAN_DIR_PATTERN = /^(\d{3,})-(.+)$/;
const DATE_DIR_PATTERN = /^(\d{2})-(\d{2})$/;
const YEAR_DIR_PATTERN = /^\d{4}$/;

export function discoverPlans(
  vaultPath: string,
  planPathRelative: string,
  config: Config,
): PlanInfo[] {
  const plans: PlanInfo[] = [];
  const basePath = join(vaultPath, planPathRelative);

  if (!existsSync(basePath)) return plans;

  // Walk: <basePath>/<yyyy>/<mm-dd>/<counter-slug>/plan.md
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
        const planDirPath = join(datePath, planEntry);
        if (!isDir(planDirPath)) continue;

        const planFile = join(planDirPath, "plan.md");
        if (!existsSync(planFile)) continue;

        const info = parsePlanFile(
          planFile,
          planPathRelative,
          yearEntry,
          dateEntry,
          planEntry,
          vaultPath,
          config,
        );
        if (info) plans.push(info);
      }
    }
  }

  plans.sort((a, b) => a.date.localeCompare(b.date) || a.planDir.localeCompare(b.planDir));
  return plans;
}

function parsePlanFile(
  planFile: string,
  planPathRelative: string,
  year: string,
  dateDir: string,
  planEntry: string,
  vaultPath: string,
  config: Config,
): PlanInfo | null {
  let content: string;
  try {
    content = readFileSync(planFile, "utf-8");
  } catch {
    return null;
  }

  const planDir = `${planPathRelative}/${year}/${dateDir}/${planEntry}`;
  const planPath = `${planDir}/plan`;
  const fm = parsePlanFrontmatter(content);

  // Strip frontmatter before extracting title
  const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const title = extractTitle(bodyContent);

  // Extract date/time from frontmatter or directory structure
  let date: string;
  let time = "";
  let ampmTime = "";
  let journalPath: string;

  if (fm.datetime) {
    // Parse from frontmatter: "2026-03-29T14:30"
    const [datePart, timePart] = fm.datetime.split("T");
    date = datePart;
    if (timePart) {
      time = timePart;
      const [hh, mm] = timePart.split(":").map(Number);
      ampmTime = formatAmPm(hh, mm);
    }
  } else {
    // Fallback: derive from directory path + file mtime
    const [mm, dd] = dateDir.split("-");
    date = `${year}-${mm}-${dd}`;
    try {
      const stat = statSync(planFile);
      const mtime = stat.mtime;
      time = `${String(mtime.getHours()).padStart(2, "0")}:${String(mtime.getMinutes()).padStart(2, "0")}`;
      ampmTime = formatAmPm(mtime.getHours(), mtime.getMinutes());
    } catch { /* no time available */ }
  }

  if (fm.journalPath) {
    journalPath = fm.journalPath;
  } else {
    // Build journal path from date
    const d = new Date(date + "T12:00:00");
    journalPath = getJournalPathForDate(config, d);
  }

  // Check for existing journal entry
  const hasJournalEntry = checkJournalEntry(vaultPath, journalPath, planPath);

  return {
    planDir,
    planPath,
    title,
    date,
    time,
    ampmTime,
    journalPath,
    tags: fm.tags || [],
    hasJournalEntry,
  };
}

export function checkJournalEntry(
  vaultPath: string,
  journalPath: string,
  planPath: string,
): boolean {
  const journalFile = join(vaultPath, journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`);
  try {
    const content = readFileSync(journalFile, "utf-8");
    return content.includes(`[[${planPath}`);
  } catch {
    return false;
  }
}

// ---- Filtering ----

export function filterPlans(
  plans: PlanInfo[],
  args: CliArgs,
): PlanInfo[] {
  let filtered = plans;

  if (args.from) {
    filtered = filtered.filter((p) => p.date >= args.from!);
  }
  if (args.to) {
    filtered = filtered.filter((p) => p.date <= args.to!);
  }
  if (args.plans) {
    const planSet = new Set(args.plans);
    filtered = filtered.filter((p) => planSet.has(p.planDir));
  }

  return filtered;
}

// ---- Backport ----

const PLAN_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given an engineering plan, output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.
Line 2: 1-2 lowercase kebab-case tags relevant to the plan topic (comma-separated, no # prefix).
Output ONLY these two lines.`;

function fallbackSummary(content: string): string {
  return content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^(?:#+\s*|\|.*\|$|\s*[-*]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "Captured from Claude Code session.";
}

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
    if (plan.hasJournalEntry) {
      result.skipped++;
      result.details.push({
        planDir: plan.planDir,
        title: plan.title,
        status: "skipped",
        reason: "Journal entry already exists",
      });
      continue;
    }

    try {
      // Read plan content for summarization
      const planFile = join(vaultPath, `${plan.planPath}.md`);
      const content = readFileSync(planFile, "utf-8");

      let summary: string;
      let tags: string;

      if (options.skipSummarize) {
        summary = fallbackSummary(content);
        tags = plan.tags.length > 0 ? plan.tags.join(",") : "claude-session";
      } else {
        const result = await summarizeWithClaude(content, PLAN_SYSTEM_PROMPT);
        summary = result.summary;
        tags = result.tags;
      }

      const timeDisplay = plan.ampmTime || "Plan";
      const journalEntry = `\\n### ${plan.title}\\n\\n| | |\\n|---|---|\\n| [[${plan.planPath}\\|${timeDisplay}]] | ${summary} |`;

      if (!options.dryRun) {
        appendToJournal(journalEntry, plan.journalPath, config.vault);
        mergeTagsOnDailyNote(tags, plan.journalPath, config.vault);
      }

      result.created++;
      result.details.push({
        planDir: plan.planDir,
        title: plan.title,
        status: "created",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${plan.planDir}: ${msg}`);
      result.details.push({
        planDir: plan.planDir,
        title: plan.title,
        status: "error",
        reason: msg,
      });
    }
  }

  return result;
}

// ---- Helpers ----

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

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.cwd);
  const vaultPath = getVaultPath(config.vault);

  if (!vaultPath) {
    console.error(JSON.stringify({ error: "Cannot resolve vault path. Check your capture-plan.toml config." }));
    process.exit(1);
  }

  const plans = discoverPlans(vaultPath, config.plan_path, config);

  if (args.list) {
    const filtered = filterPlans(plans, args);
    console.log(JSON.stringify(filtered, null, 2));
    process.exit(0);
  }

  if (!args.all && !args.from && !args.to && !args.plans) {
    console.error(JSON.stringify({ error: "Specify --all, --from/--to, or --plans to select plans for backport." }));
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
