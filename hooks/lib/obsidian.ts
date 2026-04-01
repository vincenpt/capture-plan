// obsidian.ts — Obsidian CLI & vault operations

import { getDatePartsFor } from "./dates.ts";
import { mergeTags } from "./text.ts";
import type { Config } from "./types.ts";

/** Execute the Obsidian CLI with the given arguments, optionally scoped to a vault. */
export function runObsidian(args: string[], vault?: string): { stdout: string; exitCode: number } {
  try {
    const cmd = vault ? ["obsidian", `vault=${vault}`, ...args] : ["obsidian", ...args];
    const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = result.stdout.toString().trim();
    // Obsidian CLI returns exitCode 0 even on errors — detect via stdout
    const exitCode = result.exitCode !== 0 || stdout.startsWith("Error:") ? 1 : 0;
    return { stdout, exitCode };
  } catch {
    return { stdout: "", exitCode: 1 };
  }
}

/** Create a note in the vault at the given path, escaping newlines for the CLI. */
export function createVaultNote(
  path: string,
  content: string,
  vault?: string,
): { success: boolean; exitCode: number } {
  const escaped = content.replace(/\n/g, "\\n");
  const result = runObsidian(["create", `path=${path}`, `content=${escaped}`, "silent"], vault);
  return { success: result.exitCode === 0, exitCode: result.exitCode };
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

/** Build the Obsidian vault path for the daily journal note on a given date. */
export function getJournalPathForDate(config: Config, date: Date): string {
  const { dd, mm, yyyy, monthName, dayName } = getDatePartsFor(date);
  return `${config.journal_path}/${yyyy}/${mm}-${monthName}/${dd}-${dayName}`;
}

/** Build the Obsidian vault path for today's daily journal note. */
export function getJournalPath(config: Config): string {
  return getJournalPathForDate(config, new Date());
}

/** Append content to a journal note, creating the note first if it doesn't exist. */
export function appendToJournal(content: string, journalPath: string, vault?: string): void {
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const result = runObsidian(["append", `path=${pathWithExt}`, `content=${content}`], vault);
  if (result.exitCode !== 0) {
    // File doesn't exist yet — create it, then append
    runObsidian(["create", `path=${journalPath}`, "content= ", "silent"], vault);
    runObsidian(["append", `path=${pathWithExt}`, `content=${content}`], vault);
  }
}
