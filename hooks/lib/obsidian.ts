// obsidian.ts — Obsidian CLI & vault operations

import { join } from "node:path";
import { type DateParts, formatDatePath, getDatePartsFor } from "./dates.ts";
import { appendRevisionToCallout } from "./session-state.ts";
import { ensureMdExt, escapeForObsidianAppend, formatJournalCallout, mergeTags } from "./text.ts";
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

/** Create or replace a note in the vault via the Obsidian CLI.
 *  If the file already exists, moves it to a backup path first to free the index entry,
 *  then creates the new file at the original path and deletes the backup.
 *  Using delete+create directly causes a race condition where the indexer hasn't processed
 *  the delete before the create arrives, producing numbered duplicates (e.g. "summary 1.md"). */
export function createVaultNote(
  path: string,
  content: string,
  vault?: string,
): { success: boolean; exitCode: number; stdout: string; stderr: string } {
  const pathWithExt = ensureMdExt(path);
  const needsReplace = vaultFileExists(pathWithExt, vault);
  const bakPath = pathWithExt.replace(/\.md$/, ".capture-plan-bak.md");

  if (needsReplace) {
    // Move frees the index entry synchronously (unlike delete)
    runObsidian(["delete", `path=${bakPath}`, "permanent"], vault);
    runObsidian(["move", `path=${pathWithExt}`, `to=${bakPath}`], vault);
  }

  const escaped = content.replace(/\n/g, "\\n");
  const result = runObsidian(["create", `path=${path}`, `content=${escaped}`, "silent"], vault);

  if (needsReplace) {
    runObsidian(["delete", `path=${bakPath}`, "permanent"], vault);
  }

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

/** List immediate child folder names under a vault folder. */
export function listVaultFolders(folderRel: string, vault?: string): string[] {
  const result = runObsidian(["folders", `folder=${folderRel}`], vault);
  if (result.exitCode !== 0) return [];
  const prefix = `${folderRel}/`;
  const depth = folderRel.split("/").length + 1;
  return result.stdout
    .split("\n")
    .filter((line) => {
      if (!line?.startsWith(prefix)) return false;
      return line.split("/").length === depth;
    })
    .map((line) => line.slice(prefix.length));
}

/** List immediate child file names under a vault folder (non-recursive). */
export function listVaultFiles(folderRel: string, vault?: string): string[] {
  const result = runObsidian(["files", `folder=${folderRel}`], vault);
  if (result.exitCode !== 0) return [];
  const prefix = `${folderRel}/`;
  return result.stdout
    .split("\n")
    .filter((line) => {
      if (!line?.startsWith(prefix)) return false;
      const rest = line.slice(prefix.length);
      return !rest.includes("/");
    })
    .map((line) => line.slice(prefix.length));
}

/** Check if a folder exists in the vault. */
export function vaultFolderExists(folderRel: string, vault?: string): boolean {
  const result = runObsidian(["folder", `path=${folderRel}`], vault);
  return result.exitCode === 0;
}

/** Check if a file exists in the vault. */
export function vaultFileExists(pathRel: string, vault?: string): boolean {
  const result = runObsidian(["file", `path=${pathRel}`], vault);
  return result.exitCode === 0;
}

/** Ensure a vault directory exists by creating and deleting a placeholder file.
 *  The Obsidian CLI `create` command creates parent directories automatically. */
export function ensureVaultDir(dirRel: string, vault?: string): void {
  const placeholder = `${dirRel}/placeholder.md`;
  runObsidian(["create", `path=${placeholder}`, "content=placeholder", "silent"], vault);
  runObsidian(["delete", `path=${placeholder}`, "permanent"], vault);
}

/** Read existing tags from a daily note and merge in new ones, deduplicating. */
export function mergeTagsOnDailyNote(newTags: string, journalPath: string, vault?: string): void {
  if (!journalPath) return;
  const pathWithExt = ensureMdExt(journalPath);
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
  const pathWithExt = ensureMdExt(journalPath);
  const escaped = escapeForObsidianAppend(content);
  const result = runObsidian(["append", `path=${pathWithExt}`, `content=${escaped}`], vault);
  if (result.exitCode !== 0) {
    // File doesn't exist yet — create it, then append
    runObsidian(["create", `path=${pathWithExt}`, "content= "], vault);
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
  const pathWithExt = ensureMdExt(journalPath);

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

/** Try to append a revision to an existing callout in the journal; if the callout doesn't exist, create a new one via the Obsidian CLI. When `fallbackJournalPath` is provided, the fallback write targets that path instead of `journalPath` (used when the append target is a prior day's journal). */
export async function appendOrCreateCallout(
  title: string,
  revision: string,
  project: string,
  source: string,
  journalPath: string,
  vaultPath: string | null,
  vault?: string,
  fallbackJournalPath?: string,
): Promise<void> {
  let appended = false;
  if (vaultPath) {
    const fullJournalPath = join(vaultPath, ensureMdExt(journalPath));
    appended = await appendRevisionToCallout(title, revision, fullJournalPath, journalPath, vault);
  }
  if (!appended) {
    const callout = formatJournalCallout(title, project, source, revision);
    appendToJournal(`\n\n${callout}`, fallbackJournalPath ?? journalPath, vault);
  }
}
