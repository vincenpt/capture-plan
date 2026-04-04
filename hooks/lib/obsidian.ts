// obsidian.ts — Obsidian CLI & vault operations

import { type DateParts, formatDatePath, getDatePartsFor } from "./dates.ts";
import { escapeForObsidianAppend, mergeTags } from "./text.ts";
import type { Config } from "./types.ts";

/** Execute the Obsidian CLI with the given arguments, optionally scoped to a vault. */
export function runObsidian(
  args: string[],
  vault?: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const cmd = vault ? ["obsidian", `vault=${vault}`, ...args] : ["obsidian", ...args];
    const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString().trim();
    // Obsidian CLI returns exitCode 0 even on errors — detect via stdout
    const exitCode = result.exitCode !== 0 || stdout.startsWith("Error:") ? 1 : 0;
    return { stdout, stderr, exitCode };
  } catch {
    return { stdout: "", stderr: "", exitCode: 1 };
  }
}

/** Create a note in the vault at the given path, escaping newlines for the CLI. */
export function createVaultNote(
  path: string,
  content: string,
  vault?: string,
): { success: boolean; exitCode: number; stdout: string; stderr: string } {
  const escaped = content.replace(/\n/g, "\\n");
  const result = runObsidian(["create", `path=${path}`, `content=${escaped}`, "silent"], vault);
  return {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Resolve the absolute filesystem path of an Obsidian vault via the CLI. */
export function getVaultPath(vault?: string): string | null {
  try {
    const args = vault
      ? ["obsidian", `vault=${vault}`, "vault", "info=path"]
      : ["obsidian", "vault", "info=path"];
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    const path = result.stdout.toString().trim();
    return path && result.exitCode === 0 ? path : null;
  } catch {
    return null;
  }
}

/** Read existing tags from a daily note and merge in new ones, deduplicating. */
export function mergeTagsOnDailyNote(newTags: string, journalPath: string, vault?: string): void {
  if (!journalPath) return;
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const tagsResult = runObsidian(["property:read", `name=tags`, `path=${pathWithExt}`], vault);
  const existingTags = tagsResult.stdout
    .split("\n")
    .filter((l) => !l.startsWith("Error:") && l.trim());
  const mergedTags = mergeTags(existingTags, newTags);
  if (!mergedTags) return;
  runObsidian(
    ["property:set", `name=tags`, `value=${mergedTags}`, "type=list", `path=${pathWithExt}`],
    vault,
  );
}

/** Build the date directory path for plans using the configured scheme. */
export function getPlanDatePath(config: Config, dateParts: DateParts): string {
  return `${config.plan.path}/${formatDatePath(config.plan.date_scheme, dateParts)}`;
}

/** Build the Obsidian vault path for the daily journal note on a given date. */
export function getJournalPathForDate(config: Config, date: Date): string {
  const parts = getDatePartsFor(date);
  return `${config.journal.path}/${formatDatePath(config.journal.date_scheme, parts)}`;
}

/** Build the Obsidian vault path for today's daily journal note. */
export function getJournalPath(config: Config): string {
  return getJournalPathForDate(config, new Date());
}

/** Append content to a journal note, creating the note first if it doesn't exist. Content is escaped for the Obsidian CLI automatically. */
export function appendToJournal(content: string, journalPath: string, vault?: string): void {
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const escaped = escapeForObsidianAppend(content);
  const result = runObsidian(["append", `path=${pathWithExt}`, `content=${escaped}`], vault);
  if (result.exitCode !== 0) {
    // File doesn't exist yet — create it, then append
    runObsidian(["create", `path=${journalPath}`, "content= ", "silent"], vault);
    runObsidian(["append", `path=${pathWithExt}`, `content=${escaped}`], vault);
  }
}

/** Properties to set or update on the daily journal note frontmatter. */
export interface JournalFrontmatterProps {
  date: string;
  day: string;
  project: string;
  tags: string;
}

/** Set or update frontmatter properties on the daily journal note (date, day, plans count, projects list, tags). */
export function updateJournalFrontmatter(
  journalPath: string,
  props: JournalFrontmatterProps,
  vault?: string,
): void {
  if (!journalPath) return;
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;

  // date and day: idempotent set
  runObsidian(
    ["property:set", `name=date`, `value=${props.date}`, "type=date", `path=${pathWithExt}`],
    vault,
  );
  runObsidian(
    ["property:set", `name=day`, `value=${props.day}`, "type=text", `path=${pathWithExt}`],
    vault,
  );

  // plans: read current count, increment by 1
  const plansResult = runObsidian(["property:read", `name=plans`, `path=${pathWithExt}`], vault);
  const currentPlans = parseInt(plansResult.stdout, 10) || 0;
  runObsidian(
    [
      "property:set",
      `name=plans`,
      `value=${currentPlans + 1}`,
      "type=number",
      `path=${pathWithExt}`,
    ],
    vault,
  );

  // projects: read current list, add project if not present
  if (props.project) {
    const projResult = runObsidian(
      ["property:read", `name=projects`, `path=${pathWithExt}`],
      vault,
    );
    const existingProjects = projResult.stdout
      .split("\n")
      .filter((l) => !l.startsWith("Error:") && l.trim());
    if (!existingProjects.includes(props.project)) {
      const merged = [...existingProjects, props.project].join(",");
      runObsidian(
        ["property:set", `name=projects`, `value=${merged}`, "type=list", `path=${pathWithExt}`],
        vault,
      );
    }
  }

  // tags: delegate to existing mergeTagsOnDailyNote
  mergeTagsOnDailyNote(props.tags, journalPath, vault);
}
