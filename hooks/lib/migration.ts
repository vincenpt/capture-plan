// migration.ts — Vault layout detection and migration utilities
// All vault operations go through the Obsidian CLI to keep the vault index in sync.

import { type DateScheme, formatDatePath, getDatePartsFor } from "./dates.ts";
import {
  COMPACT_DATE_PATTERN,
  DAY_ONLY_PATTERN,
  FLAT_DATE_PATTERN,
  NUM_NAME_PATTERN,
  PLAN_DIR_PATTERN,
  YEAR_PATTERN,
} from "./fs.ts";
import {
  ensureVaultDir,
  listVaultFiles,
  listVaultFolders,
  runObsidian,
  vaultFileExists,
  vaultFolderExists,
} from "./obsidian.ts";

/** Convert a date path from one scheme to another. Returns the new path segment, or null on parse failure. */
function remapDatePath(
  fromScheme: DateScheme,
  year: string,
  segments: string[],
  toScheme: DateScheme,
): string | null {
  const date = parseDateFromPath(fromScheme, year, segments);
  if (!date) return null;
  return formatDatePath(toScheme, getDatePartsFor(date));
}

/** Classify a directory entry under a year dir into its date scheme. */
export function classifyDateEntry(entry: string, children?: string[]): DateScheme | undefined {
  if (COMPACT_DATE_PATTERN.test(entry)) return "compact";

  if (NUM_NAME_PATTERN.test(entry) && children) {
    for (const child of children) {
      if (NUM_NAME_PATTERN.test(child)) return "calendar";
      if (DAY_ONLY_PATTERN.test(child)) return "monthly";
    }
  }

  return undefined;
}

/** Scan a vault path to detect which date schemes are present via the Obsidian CLI. */
export function detectVaultSchemes(baseRel: string, vault?: string): Set<DateScheme> {
  const schemes = new Set<DateScheme>();

  const allFolders = listVaultFolders(baseRel, vault);

  for (const entry of allFolders) {
    if (FLAT_DATE_PATTERN.test(entry)) {
      schemes.add("flat");
      continue;
    }

    if (!YEAR_PATTERN.test(entry)) continue;
    const yearRel = `${baseRel}/${entry}`;

    for (const dateEntry of listVaultFolders(yearRel, vault)) {
      if (COMPACT_DATE_PATTERN.test(dateEntry)) {
        schemes.add("compact");
      } else if (NUM_NAME_PATTERN.test(dateEntry)) {
        const children = listVaultFolders(`${yearRel}/${dateEntry}`, vault);
        const scheme = classifyDateEntry(dateEntry, children.length > 0 ? children : undefined);
        if (scheme) schemes.add(scheme);
      }
    }
  }

  return schemes;
}

/** Derive a Date from path components based on the source scheme.
 *  For flat scheme, year is ignored since the date is embedded in segments[0]. */
export function parseDateFromPath(
  scheme: DateScheme,
  year: string,
  segments: string[],
): Date | null {
  try {
    if (scheme === "flat") {
      const parts = segments[0].split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0);
    }

    const y = parseInt(year, 10);
    switch (scheme) {
      case "compact": {
        const [mm, dd] = segments[0].split("-").map(Number);
        return new Date(y, mm - 1, dd, 12, 0);
      }
      case "calendar": {
        const mm = parseInt(segments[0].split("-")[0], 10);
        const dd = parseInt(segments[1].split("-")[0], 10);
        return new Date(y, mm - 1, dd, 12, 0);
      }
      case "monthly": {
        const mm = parseInt(segments[0].split("-")[0], 10);
        const dd = parseInt(segments[1], 10);
        return new Date(y, mm - 1, dd, 12, 0);
      }
    }
  } catch {
    return null;
  }
}

/** A planned file/directory move. Paths are vault-relative. */
export interface MoveEntry {
  from: string;
  to: string;
  type: "plan-dir" | "journal-file" | "loose";
}

/** Compute all moves needed to migrate plan directories from one scheme to another.
 *  All paths in the returned MoveEntry are vault-relative. */
export function computePlanMoves(
  baseRel: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  vault?: string,
): MoveEntry[] {
  const moves: MoveEntry[] = [];
  if (fromScheme === toScheme) return moves;

  if (fromScheme === "flat") {
    for (const entry of listVaultFolders(baseRel, vault)) {
      if (!FLAT_DATE_PATTERN.test(entry)) continue;
      const entryRel = `${baseRel}/${entry}`;

      const targetSeg = remapDatePath("flat", "", [entry], toScheme);
      if (!targetSeg) continue;
      const targetRel = `${baseRel}/${targetSeg}`;

      for (const planEntry of listVaultFolders(entryRel, vault)) {
        moves.push({
          from: `${entryRel}/${planEntry}`,
          to: `${targetRel}/${planEntry}`,
          type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
        });
      }
      // Also check for loose files
      for (const file of listVaultFiles(entryRel, vault)) {
        moves.push({
          from: `${entryRel}/${file}`,
          to: `${targetRel}/${file}`,
          type: "loose",
        });
      }
    }
    return moves;
  }

  for (const yearEntry of listVaultFolders(baseRel, vault)) {
    if (!YEAR_PATTERN.test(yearEntry)) continue;
    const yearRel = `${baseRel}/${yearEntry}`;

    collectPlanMovesUnderYear(yearRel, yearEntry, fromScheme, toScheme, baseRel, moves, vault);
  }

  return moves;
}

function collectPlanMovesUnderYear(
  yearRel: string,
  year: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  baseRel: string,
  moves: MoveEntry[],
  vault?: string,
): void {
  for (const dateEntry of listVaultFolders(yearRel, vault)) {
    const dateRel = `${yearRel}/${dateEntry}`;

    if (fromScheme === "compact" && COMPACT_DATE_PATTERN.test(dateEntry)) {
      const targetSeg = remapDatePath("compact", year, [dateEntry], toScheme);
      if (!targetSeg) continue;

      for (const planEntry of listVaultFolders(dateRel, vault)) {
        if (planEntry.startsWith(".")) continue;
        moves.push({
          from: `${dateRel}/${planEntry}`,
          to: `${baseRel}/${targetSeg}/${planEntry}`,
          type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
        });
      }
    } else if (
      (fromScheme === "calendar" || fromScheme === "monthly") &&
      NUM_NAME_PATTERN.test(dateEntry)
    ) {
      for (const dayEntry of listVaultFolders(dateRel, vault)) {
        const isCalendar = NUM_NAME_PATTERN.test(dayEntry);
        const isMonthly = DAY_ONLY_PATTERN.test(dayEntry);

        if ((fromScheme === "calendar" && isCalendar) || (fromScheme === "monthly" && isMonthly)) {
          const targetSeg = remapDatePath(fromScheme, year, [dateEntry, dayEntry], toScheme);
          if (!targetSeg) continue;
          const dayRel = `${dateRel}/${dayEntry}`;

          for (const planEntry of listVaultFolders(dayRel, vault)) {
            if (planEntry.startsWith(".")) continue;
            moves.push({
              from: `${dayRel}/${planEntry}`,
              to: `${baseRel}/${targetSeg}/${planEntry}`,
              type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
            });
          }
        }
      }
    }
  }
}

/** Compute all moves needed to migrate journal files from one scheme to another.
 *  All paths in the returned MoveEntry are vault-relative. */
export function computeJournalMoves(
  baseRel: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  vault?: string,
): MoveEntry[] {
  const moves: MoveEntry[] = [];
  if (fromScheme === toScheme) return moves;

  if (fromScheme === "flat") {
    for (const file of listVaultFiles(baseRel, vault)) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue;
      const targetSeg = remapDatePath("flat", "", [file.replace(/\.md$/, "")], toScheme);
      if (!targetSeg) continue;
      moves.push({
        from: `${baseRel}/${file}`,
        to: `${baseRel}/${targetSeg}.md`,
        type: "journal-file",
      });
    }
    return moves;
  }

  for (const yearEntry of listVaultFolders(baseRel, vault)) {
    if (!YEAR_PATTERN.test(yearEntry)) continue;
    const yearRel = `${baseRel}/${yearEntry}`;

    collectJournalMovesUnderYear(yearRel, yearEntry, fromScheme, toScheme, baseRel, moves, vault);
  }

  return moves;
}

function collectJournalMovesUnderYear(
  yearRel: string,
  year: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  baseRel: string,
  moves: MoveEntry[],
  vault?: string,
): void {
  if (fromScheme === "compact") {
    for (const file of listVaultFiles(yearRel, vault)) {
      if (!/^\d{2}-\d{2}\.md$/.test(file)) continue;
      const targetSeg = remapDatePath("compact", year, [file.replace(/\.md$/, "")], toScheme);
      if (!targetSeg) continue;
      moves.push({
        from: `${yearRel}/${file}`,
        to: `${baseRel}/${targetSeg}.md`,
        type: "journal-file",
      });
    }
  } else {
    for (const entry of listVaultFolders(yearRel, vault)) {
      if (!NUM_NAME_PATTERN.test(entry)) continue;
      const entryRel = `${yearRel}/${entry}`;

      for (const dayFile of listVaultFiles(entryRel, vault)) {
        if (fromScheme === "calendar" && /^\d{2}-[A-Z][a-z]+\.md$/.test(dayFile)) {
          const targetSeg = remapDatePath(
            "calendar",
            year,
            [entry, dayFile.replace(/\.md$/, "")],
            toScheme,
          );
          if (!targetSeg) continue;
          moves.push({
            from: `${entryRel}/${dayFile}`,
            to: `${baseRel}/${targetSeg}.md`,
            type: "journal-file",
          });
        } else if (fromScheme === "monthly" && /^\d{2}\.md$/.test(dayFile)) {
          const targetSeg = remapDatePath(
            "monthly",
            year,
            [entry, dayFile.replace(/\.md$/, "")],
            toScheme,
          );
          if (!targetSeg) continue;
          moves.push({
            from: `${entryRel}/${dayFile}`,
            to: `${baseRel}/${targetSeg}.md`,
            type: "journal-file",
          });
        }
      }
    }
  }
}

/** Move a single file via the Obsidian CLI, ensuring the target directory exists. */
function moveVaultFile(
  fromRel: string,
  toRel: string,
  ensuredDirs: Set<string>,
  vault?: string,
): void {
  const dir = toRel.split("/").slice(0, -1).join("/");
  if (dir && !ensuredDirs.has(dir)) {
    ensureVaultDir(dir, vault);
    ensuredDirs.add(dir);
  }
  runObsidian(["move", `path=${fromRel}`, `to=${toRel}`], vault);
}

/** Execute a list of moves via the Obsidian CLI.
 *  Returns count of moves executed. When the target already exists, plan directories
 *  are merged (source files that don't exist in the target are moved over) and journal
 *  files are skipped. All paths in moves must be vault-relative. */
export function executeMoves(moves: MoveEntry[], vault?: string): number {
  let count = 0;
  const ensuredDirs = new Set<string>();

  for (const move of moves) {
    if (move.from === move.to) continue;

    if (move.type === "plan-dir" && vaultFolderExists(move.to, vault)) {
      // Merge: move individual files that don't exist at destination
      for (const file of listVaultFiles(move.from, vault)) {
        if (!vaultFileExists(`${move.to}/${file}`, vault)) {
          moveVaultFile(`${move.from}/${file}`, `${move.to}/${file}`, ensuredDirs, vault);
        }
      }
      for (const sub of listVaultFolders(move.from, vault)) {
        for (const file of listVaultFiles(`${move.from}/${sub}`, vault)) {
          if (!vaultFileExists(`${move.to}/${sub}/${file}`, vault)) {
            moveVaultFile(
              `${move.from}/${sub}/${file}`,
              `${move.to}/${sub}/${file}`,
              ensuredDirs,
              vault,
            );
          }
        }
      }
      // Delete remaining source files via CLI
      for (const file of listVaultFiles(move.from, vault)) {
        runObsidian(["delete", `path=${move.from}/${file}`, "permanent"], vault);
      }
      for (const sub of listVaultFolders(move.from, vault)) {
        for (const file of listVaultFiles(`${move.from}/${sub}`, vault)) {
          runObsidian(["delete", `path=${move.from}/${sub}/${file}`, "permanent"], vault);
        }
      }
    } else if (move.type === "plan-dir") {
      // Move each file individually (CLI operates on files, not directories)
      for (const file of listVaultFiles(move.from, vault)) {
        moveVaultFile(`${move.from}/${file}`, `${move.to}/${file}`, ensuredDirs, vault);
      }
      for (const sub of listVaultFolders(move.from, vault)) {
        for (const file of listVaultFiles(`${move.from}/${sub}`, vault)) {
          moveVaultFile(
            `${move.from}/${sub}/${file}`,
            `${move.to}/${sub}/${file}`,
            ensuredDirs,
            vault,
          );
        }
      }
    } else if (!vaultFileExists(move.to, vault)) {
      // journal-file or loose: single file move
      moveVaultFile(move.from, move.to, ensuredDirs, vault);
    }
    count++;
  }
  return count;
}
