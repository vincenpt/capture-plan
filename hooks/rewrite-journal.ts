#!/usr/bin/env bun
// rewrite-journal.ts — Rewrite a day's journal from existing plan/summary/activity notes
// CLI script (not a hook). Run via: bun hooks/rewrite-journal.ts [options]

import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DateScheme } from "./lib/dates.ts";
import { parseDateFromPath } from "./lib/migration.ts";
import { DONE_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, SKILL_SYSTEM_PROMPT } from "./lib/prompts.ts";
import {
  appendOrCreateCallout,
  type Config,
  ensureMdExt,
  extractTitle,
  FLAT_DATE_PATTERN,
  filterNoiseTags,
  formatAmPm,
  formatDatePath,
  formatJournalRevision,
  getDatePartsFor,
  getDayName,
  getJournalPathForDate,
  getVaultPath,
  isDir,
  loadConfig,
  PLAN_DIR_PATTERN,
  parsePlanFrontmatter,
  safeReaddir,
  summarizeWithClaude,
  updateJournalFrontmatter,
  YEAR_PATTERN,
} from "./shared.ts";

/** Metadata for a day that has plan directories in the vault. */
export interface DayInfo {
  date: string;
  dayName: string;
  planCount: number;
  hasJournal: boolean;
  hasBackup: boolean;
}

/** Result of a journal rewrite operation. */
export interface RewriteResult {
  backedUp: boolean;
  plansProcessed: number;
  calloutsCreated: number;
  revisionsWritten: number;
  errors: string[];
}

interface CliArgs {
  listDays: boolean;
  day?: string;
  dryRun: boolean;
  skipSummarize: boolean;
  removeBackup: boolean;
  cwd?: string;
}

/** Parse CLI arguments into structured options. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    listDays: false,
    dryRun: false,
    skipSummarize: false,
    removeBackup: false,
  };
  for (const arg of argv) {
    if (arg === "--list-days") args.listDays = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-summarize") args.skipSummarize = true;
    else if (arg === "--remove-backup") args.removeBackup = true;
    else if (arg.startsWith("--day=")) args.day = arg.slice(6);
    else if (arg.startsWith("--cwd=")) args.cwd = arg.slice(6);
  }
  return args;
}

/** Find all NNN-slug plan directories directly inside a date directory. */
function findPlanDirsIn(dateDirPath: string): string[] {
  const results: string[] = [];
  for (const entry of safeReaddir(dateDirPath)) {
    if (PLAN_DIR_PATTERN.test(entry) && isDir(join(dateDirPath, entry))) {
      results.push(entry);
    }
  }
  return results.sort();
}

/** Derive a date string and Date from path segments relative to the plan root, using the configured scheme. */
function dateFromPlanPath(
  scheme: DateScheme,
  pathParts: string[],
): { date: Date; dateKey: string } | null {
  let parsed: Date | null;
  if (scheme === "flat") {
    parsed = parseDateFromPath("flat", "", [pathParts[0]]);
  } else {
    const year = pathParts[0];
    const segments = pathParts.slice(1);
    parsed = parseDateFromPath(scheme, year, segments);
  }
  if (!parsed) return null;
  const parts = getDatePartsFor(parsed);
  return { date: parsed, dateKey: parts.dateKey };
}

/** Walk the vault's plan directory tree and collect date paths that contain plan dirs. */
function collectDateDirs(
  planRoot: string,
  scheme: DateScheme,
): Array<{ pathParts: string[]; fullPath: string }> {
  const results: Array<{ pathParts: string[]; fullPath: string }> = [];

  if (scheme === "flat") {
    for (const entry of safeReaddir(planRoot)) {
      if (!FLAT_DATE_PATTERN.test(entry)) continue;
      const fullPath = join(planRoot, entry);
      if (!isDir(fullPath)) continue;
      results.push({ pathParts: [entry], fullPath });
    }
    return results;
  }

  // Year-based schemes: calendar, compact, monthly
  for (const yearEntry of safeReaddir(planRoot)) {
    if (!YEAR_PATTERN.test(yearEntry)) continue;
    const yearPath = join(planRoot, yearEntry);
    if (!isDir(yearPath)) continue;

    for (const dateEntry of safeReaddir(yearPath)) {
      const datePath = join(yearPath, dateEntry);
      if (!isDir(datePath)) continue;

      if (scheme === "compact") {
        // compact: YYYY/MM-DD/NNN-slug
        results.push({ pathParts: [yearEntry, dateEntry], fullPath: datePath });
      } else {
        // calendar: YYYY/MM-Month/DD-Day/NNN-slug
        // monthly: YYYY/MM-Month/DD/NNN-slug
        for (const dayEntry of safeReaddir(datePath)) {
          const dayPath = join(datePath, dayEntry);
          if (!isDir(dayPath)) continue;
          results.push({ pathParts: [yearEntry, dateEntry, dayEntry], fullPath: dayPath });
        }
      }
    }
  }

  return results;
}

/** Discover all days in the vault that have plan directories. */
export function discoverDays(vaultPath: string, config: Config): DayInfo[] {
  const planRoot = join(vaultPath, config.plan.path);
  const scheme = config.plan.date_scheme;
  const dateDirs = collectDateDirs(planRoot, scheme);

  const dayMap = new Map<string, DayInfo>();

  for (const { pathParts, fullPath } of dateDirs) {
    const planDirs = findPlanDirsIn(fullPath);
    if (planDirs.length === 0) continue;

    const parsed = dateFromPlanPath(scheme, pathParts);
    if (!parsed) continue;

    const existing = dayMap.get(parsed.dateKey);
    if (existing) {
      existing.planCount += planDirs.length;
    } else {
      const journalPath = getJournalPathForDate(config, parsed.date);
      const journalFullPath = join(vaultPath, ensureMdExt(journalPath));
      const backupPath = journalFullPath.replace(/\.md$/, ".bak.md");

      dayMap.set(parsed.dateKey, {
        date: parsed.dateKey,
        dayName: getDayName(parsed.date),
        planCount: planDirs.length,
        hasJournal: existsSync(journalFullPath),
        hasBackup: existsSync(backupPath),
      });
    }
  }

  return [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Extract extra frontmatter fields not covered by parsePlanFrontmatter (model, source, duration). */
function parseExtraFrontmatter(content: string): {
  model?: string;
  source?: string;
  duration?: string;
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const fm = fmMatch[1];

  const modelMatch = fm.match(/^model:\s*(.+)/m);
  const sourceMatch = fm.match(/^source:\s*(.+)/m);
  const durationMatch = fm.match(/^duration:\s*"?([^"\n]+)"?/m);

  return {
    model: modelMatch ? modelMatch[1].trim() : undefined,
    source: sourceMatch ? sourceMatch[1].trim() : undefined,
    duration: durationMatch ? durationMatch[1].trim() : undefined,
  };
}

/** Extract the body content (after frontmatter) from a markdown file. */
function extractBody(content: string): string {
  const fmEnd = content.match(/^---\n[\s\S]*?\n---\n?/);
  return fmEnd ? content.slice(fmEnd[0].length).trim() : content.trim();
}

/** Fast fallback summary extraction (no API call). */
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

/** Extract the Summary section body from a summary.md note. */
function extractSummarySection(content: string): string {
  const body = extractBody(content);
  const summaryMatch = body.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n---|\n*$)/);
  return summaryMatch ? summaryMatch[1].trim() : body;
}

/** Pre-parsed data for a single plan directory, collected before summarization. */
interface PlanDirData {
  planDirName: string;
  planDirRelative: string;
  primaryNoteName: string;
  primaryLinkText: string;
  primaryContent: string;
  title: string;
  project: string;
  source: string;
  modelLabel: string;
  ampmTime: string;
  planTags: string;
  hasSummary: boolean;
  summaryContent?: string;
  summaryModelLabel?: string;
  summaryAmpmTime?: string;
}

/** A single summarization task to be run in parallel. */
interface SummarizeTask {
  key: string;
  label: string;
  content: string;
  systemPrompt: string;
}

const SUMMARIZE_CONCURRENCY = 5;

/** Run async tasks in parallel with a concurrency limit. */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Rewrite the journal for a specific day from existing vault plan/summary/activity notes. */
export async function rewriteJournal(
  dateStr: string,
  vaultPath: string,
  config: Config,
  options: { dryRun: boolean; skipSummarize: boolean },
): Promise<RewriteResult> {
  const result: RewriteResult = {
    backedUp: false,
    plansProcessed: 0,
    calloutsCreated: 0,
    revisionsWritten: 0,
    errors: [],
  };

  const date = new Date(`${dateStr}T12:00:00`);
  const dateParts = getDatePartsFor(date);
  const planDatePath = formatDatePath(config.plan.date_scheme, dateParts);
  const planDateDir = join(vaultPath, config.plan.path, planDatePath);
  const journalPath = getJournalPathForDate(config, date);
  const journalFullPath = join(vaultPath, ensureMdExt(journalPath));
  const backupPath = journalFullPath.replace(/\.md$/, ".bak.md");

  // Find plan directories for this day
  const planDirNames = findPlanDirsIn(planDateDir);
  if (planDirNames.length === 0) {
    result.errors.push(`No plan directories found in ${planDatePath}`);
    return result;
  }

  // Backup existing journal
  if (existsSync(journalFullPath) && !options.dryRun) {
    renameSync(journalFullPath, backupPath);
    result.backedUp = true;
  } else if (existsSync(journalFullPath)) {
    result.backedUp = true; // Would back up in non-dry-run
  }

  // --- Phase 1: Collect plan data and summarization tasks ---
  const planDataList: PlanDirData[] = [];
  const summarizeTasks: SummarizeTask[] = [];
  const needsSummarization = !options.skipSummarize && !options.dryRun;

  for (const planDirName of planDirNames) {
    const planDirRelative = `${config.plan.path}/${planDatePath}/${planDirName}`;
    const planDirAbsolute = join(vaultPath, planDirRelative);

    try {
      const planFilePath = join(planDirAbsolute, "plan.md");
      const activityFilePath = join(planDirAbsolute, "activity.md");

      let primaryPath: string;
      let primaryLinkText: string;
      let primaryNoteName: string;
      if (existsSync(planFilePath)) {
        primaryPath = planFilePath;
        primaryLinkText = "plan";
        primaryNoteName = "plan";
      } else if (existsSync(activityFilePath)) {
        primaryPath = activityFilePath;
        primaryLinkText = "activity";
        primaryNoteName = "activity";
      } else {
        result.errors.push(`${planDirName}: no plan.md or activity.md found`);
        continue;
      }

      const primaryContent = readFileSync(primaryPath, "utf-8");
      const fm = parsePlanFrontmatter(primaryContent);
      const extra = parseExtraFrontmatter(primaryContent);
      const title = extractTitle(extractBody(primaryContent));
      const project = fm.project ?? "";
      const source = extra.source ?? (primaryNoteName === "activity" ? "skill" : "plan-mode");
      const modelLabel = extra.model ?? "";

      let ampmTime = "Plan";
      if (fm.datetime) {
        const timeMatch = fm.datetime.match(/T(\d{2}):(\d{2})/);
        if (timeMatch) {
          ampmTime = formatAmPm(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10));
        }
      }

      const planTags = fm.tags ? filterNoiseTags(fm.tags.join(",")) : "";

      const data: PlanDirData = {
        planDirName,
        planDirRelative,
        primaryNoteName,
        primaryLinkText,
        primaryContent,
        title,
        project,
        source,
        modelLabel,
        ampmTime,
        planTags,
        hasSummary: false,
      };

      // Check for summary.md
      const summaryFilePath = join(planDirAbsolute, "summary.md");
      if (existsSync(summaryFilePath)) {
        const summaryContent = readFileSync(summaryFilePath, "utf-8");
        const summaryFm = parsePlanFrontmatter(summaryContent);
        const summaryExtra = parseExtraFrontmatter(summaryContent);

        let summaryAmpmTime = "Done";
        if (summaryFm.datetime) {
          const timeMatch = summaryFm.datetime.match(/T(\d{2}):(\d{2})/);
          if (timeMatch) {
            summaryAmpmTime = formatAmPm(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10));
          }
        }

        data.hasSummary = true;
        data.summaryContent = summaryContent;
        data.summaryModelLabel = summaryExtra.model ?? "";
        data.summaryAmpmTime = summaryAmpmTime;
      }

      planDataList.push(data);

      // Queue summarization tasks (only when calling the API)
      if (needsSummarization) {
        const planPrompt =
          primaryNoteName === "activity" ? SKILL_SYSTEM_PROMPT : PLAN_SYSTEM_PROMPT;
        summarizeTasks.push({
          key: `${planDirName}:plan`,
          label: `${planDirName} (plan)`,
          content: extractBody(primaryContent),
          systemPrompt: planPrompt,
        });

        if (data.hasSummary && data.summaryContent) {
          summarizeTasks.push({
            key: `${planDirName}:done`,
            label: `${planDirName} (done)`,
            content: extractSummarySection(data.summaryContent),
            systemPrompt: DONE_SYSTEM_PROMPT,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${planDirName}: ${msg}`);
    }
  }

  // --- Phase 2: Batch summarize in parallel ---
  const summaryResults = new Map<string, { summary: string; tags: string }>();

  if (summarizeTasks.length > 0) {
    let completed = 0;
    const total = summarizeTasks.length;

    const batchResults = await runWithConcurrency(
      summarizeTasks,
      async (task) => {
        const res = await summarizeWithClaude(task.content, task.systemPrompt);
        completed++;
        process.stderr.write(`[${completed}/${total}] Summarized: ${task.label}\n`);
        return { key: task.key, ...res };
      },
      SUMMARIZE_CONCURRENCY,
    );

    for (const r of batchResults) {
      summaryResults.set(r.key, { summary: r.summary, tags: r.tags });
    }
  }

  // --- Phase 3: Assemble revisions and write callouts ---
  const allProjects = new Set<string>();
  const allTagsList: string[] = [];
  let plansCount = 0;

  for (const data of planDataList) {
    // Resolve plan summary
    let planSummary: string;
    let planSummaryTags: string;
    const planResult = summaryResults.get(`${data.planDirName}:plan`);
    if (planResult) {
      planSummary = planResult.summary;
      planSummaryTags = planResult.tags || data.planTags || "";
    } else {
      planSummary = fallbackSummary(data.primaryContent);
      planSummaryTags = data.planTags || "";
    }

    // Build plan revision
    const planPath = `${data.planDirRelative}/${data.primaryNoteName}`;
    const revision = formatJournalRevision(
      data.ampmTime,
      planPath,
      data.primaryLinkText,
      data.modelLabel,
      planSummary,
      planSummaryTags,
    );

    if (!options.dryRun) {
      await appendOrCreateCallout(
        data.title,
        revision,
        data.project,
        data.source,
        journalPath,
        vaultPath,
        config.vault,
      );
    }
    result.calloutsCreated++;
    result.revisionsWritten++;

    if (data.project) allProjects.add(data.project);
    if (planSummaryTags) allTagsList.push(planSummaryTags);
    plansCount++;

    // Summary revision (if summary.md existed)
    if (data.hasSummary && data.summaryContent) {
      let doneSummary: string;
      let doneTags: string;
      const doneResult = summaryResults.get(`${data.planDirName}:done`);
      if (doneResult) {
        doneSummary = doneResult.summary;
        doneTags = doneResult.tags || planSummaryTags;
      } else {
        doneSummary = fallbackSummary(extractSummarySection(data.summaryContent));
        doneTags = planSummaryTags;
      }

      const summaryPath = `${data.planDirRelative}/summary`;
      const doneRevision = formatJournalRevision(
        data.summaryAmpmTime ?? "Done",
        summaryPath,
        "done",
        data.summaryModelLabel ?? "",
        doneSummary,
        doneTags,
      );

      if (!options.dryRun) {
        await appendOrCreateCallout(
          data.title,
          doneRevision,
          data.project,
          data.source,
          journalPath,
          vaultPath,
          config.vault,
        );
      }
      result.revisionsWritten++;
      if (doneTags) allTagsList.push(doneTags);
    }

    result.plansProcessed++;
  }

  // Set journal frontmatter — call once per plan to increment the plans counter correctly
  if (!options.dryRun && plansCount > 0) {
    const combinedTags = [
      ...new Set(allTagsList.flatMap((t) => t.split(",").map((s) => s.trim())).filter(Boolean)),
    ].join(",");
    // updateJournalFrontmatter increments plans count by 1 each call, so call it once per plan
    for (let i = 0; i < plansCount; i++) {
      const project = [...allProjects][i] ?? [...allProjects][0] ?? "";
      updateJournalFrontmatter(
        journalPath,
        {
          date: dateParts.dateKey,
          day: getDayName(date),
          project,
          tags: i === 0 ? combinedTags : "",
        },
        config.vault,
      );
    }
  }

  return result;
}

/** Remove the backup journal file for a given day. */
export function removeBackup(
  dateStr: string,
  vaultPath: string,
  config: Config,
): { removed: boolean; error?: string } {
  const date = new Date(`${dateStr}T12:00:00`);
  const journalPath = getJournalPathForDate(config, date);
  const journalFullPath = join(vaultPath, ensureMdExt(journalPath));
  const backupPath = journalFullPath.replace(/\.md$/, ".bak.md");

  if (!existsSync(backupPath)) {
    return { removed: false, error: "No backup file found" };
  }

  try {
    unlinkSync(backupPath);
    return { removed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { removed: false, error: msg };
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

  if (args.listDays) {
    const days = discoverDays(vaultPath, config);
    console.log(JSON.stringify(days, null, 2));
    process.exit(0);
  }

  if (args.removeBackup) {
    if (!args.day) {
      console.error(JSON.stringify({ error: "Specify --day=YYYY-MM-DD with --remove-backup" }));
      process.exit(1);
    }
    const result = removeBackup(args.day, vaultPath, config);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.removed ? 0 : 1);
  }

  if (!args.day) {
    console.error(
      JSON.stringify({ error: "Specify --list-days, --day=YYYY-MM-DD, or --remove-backup" }),
    );
    process.exit(1);
  }

  const result = await rewriteJournal(args.day, vaultPath, config, {
    dryRun: args.dryRun,
    skipSummarize: args.skipSummarize,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) main();
