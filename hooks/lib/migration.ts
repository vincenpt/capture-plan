// migration.ts — Vault layout detection and migration utilities

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type DateScheme, formatDatePath, getDatePartsFor } from "./dates.ts";
import {
  COMPACT_DATE_PATTERN,
  DAY_ONLY_PATTERN,
  FLAT_DATE_PATTERN,
  NUM_NAME_PATTERN,
  PLAN_DIR_PATTERN,
  YEAR_PATTERN,
} from "./fs.ts";

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

/** Scan a vault path to detect which date schemes are present on disk. */
export function detectVaultSchemes(basePath: string): Set<DateScheme> {
  const schemes = new Set<DateScheme>();

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(basePath, { withFileTypes: true });
  } catch {
    return schemes;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (FLAT_DATE_PATTERN.test(entry.name)) {
      schemes.add("flat");
      continue;
    }

    if (!YEAR_PATTERN.test(entry.name)) continue;
    const yearPath = join(basePath, entry.name);

    for (const dateEntry of readdirSync(yearPath, { withFileTypes: true })) {
      if (!dateEntry.isDirectory()) continue;
      const datePath = join(yearPath, dateEntry.name);

      let children: string[] | undefined;
      try {
        children = readdirSync(datePath, { withFileTypes: true })
          .filter((c) => c.isDirectory())
          .map((c) => c.name);
      } catch {
        /* skip */
      }

      const scheme = classifyDateEntry(dateEntry.name, children);
      if (scheme) schemes.add(scheme);
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

/** A planned file/directory move. */
export interface MoveEntry {
  from: string;
  to: string;
  type: "plan-dir" | "journal-file" | "loose";
}

/** Compute all moves needed to migrate plan directories from one scheme to another. */
export function computePlanMoves(
  basePath: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
): MoveEntry[] {
  const moves: MoveEntry[] = [];
  if (fromScheme === toScheme) return moves;

  if (fromScheme === "flat") {
    try {
      for (const entry of readdirSync(basePath, { withFileTypes: true })) {
        if (!entry.isDirectory() || !FLAT_DATE_PATTERN.test(entry.name)) continue;
        const entryPath = join(basePath, entry.name);

        const targetSeg = remapDatePath("flat", "", [entry.name], toScheme);
        if (!targetSeg) continue;
        const targetPath = join(basePath, targetSeg);

        for (const planEntry of readdirSync(entryPath, { withFileTypes: true })) {
          if (planEntry.name.startsWith(".")) continue;
          moves.push({
            from: join(entryPath, planEntry.name),
            to: join(targetPath, planEntry.name),
            type: PLAN_DIR_PATTERN.test(planEntry.name) ? "plan-dir" : "loose",
          });
        }
      }
    } catch {
      /* skip */
    }
    return moves;
  }

  try {
    for (const yearEntry of readdirSync(basePath, { withFileTypes: true })) {
      if (!yearEntry.isDirectory() || !YEAR_PATTERN.test(yearEntry.name)) continue;
      const yearPath = join(basePath, yearEntry.name);

      collectPlanMovesUnderYear(yearPath, yearEntry.name, fromScheme, toScheme, basePath, moves);
    }
  } catch {
    /* skip */
  }

  return moves;
}

function collectPlanMovesUnderYear(
  yearPath: string,
  year: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  basePath: string,
  moves: MoveEntry[],
): void {
  for (const dateEntry of readdirSync(yearPath, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const datePath = join(yearPath, dateEntry.name);

    if (fromScheme === "compact" && COMPACT_DATE_PATTERN.test(dateEntry.name)) {
      const targetSeg = remapDatePath("compact", year, [dateEntry.name], toScheme);
      if (!targetSeg) continue;

      for (const planEntry of readdirSync(datePath, { withFileTypes: true })) {
        if (planEntry.name.startsWith(".")) continue;
        moves.push({
          from: join(datePath, planEntry.name),
          to: join(basePath, targetSeg, planEntry.name),
          type: PLAN_DIR_PATTERN.test(planEntry.name) ? "plan-dir" : "loose",
        });
      }
    } else if (
      (fromScheme === "calendar" || fromScheme === "monthly") &&
      NUM_NAME_PATTERN.test(dateEntry.name)
    ) {
      for (const dayEntry of readdirSync(datePath, { withFileTypes: true })) {
        if (!dayEntry.isDirectory()) continue;

        const isCalendar = NUM_NAME_PATTERN.test(dayEntry.name);
        const isMonthly = DAY_ONLY_PATTERN.test(dayEntry.name);

        if ((fromScheme === "calendar" && isCalendar) || (fromScheme === "monthly" && isMonthly)) {
          const targetSeg = remapDatePath(
            fromScheme,
            year,
            [dateEntry.name, dayEntry.name],
            toScheme,
          );
          if (!targetSeg) continue;
          const dayPath = join(datePath, dayEntry.name);

          for (const planEntry of readdirSync(dayPath, { withFileTypes: true })) {
            if (planEntry.name.startsWith(".")) continue;
            moves.push({
              from: join(dayPath, planEntry.name),
              to: join(basePath, targetSeg, planEntry.name),
              type: PLAN_DIR_PATTERN.test(planEntry.name) ? "plan-dir" : "loose",
            });
          }
        }
      }
    }
  }
}

/** Compute all moves needed to migrate journal files from one scheme to another. */
export function computeJournalMoves(
  basePath: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
): MoveEntry[] {
  const moves: MoveEntry[] = [];
  if (fromScheme === toScheme) return moves;

  if (fromScheme === "flat") {
    try {
      for (const entry of readdirSync(basePath)) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(entry)) continue;
        const targetSeg = remapDatePath("flat", "", [entry.replace(/\.md$/, "")], toScheme);
        if (!targetSeg) continue;
        moves.push({
          from: join(basePath, entry),
          to: `${join(basePath, targetSeg)}.md`,
          type: "journal-file",
        });
      }
    } catch {
      /* skip */
    }
    return moves;
  }

  try {
    for (const yearEntry of readdirSync(basePath, { withFileTypes: true })) {
      if (!yearEntry.isDirectory() || !YEAR_PATTERN.test(yearEntry.name)) continue;
      const yearPath = join(basePath, yearEntry.name);

      collectJournalMovesUnderYear(yearPath, yearEntry.name, fromScheme, toScheme, basePath, moves);
    }
  } catch {
    /* skip */
  }

  return moves;
}

function collectJournalMovesUnderYear(
  yearPath: string,
  year: string,
  fromScheme: DateScheme,
  toScheme: DateScheme,
  basePath: string,
  moves: MoveEntry[],
): void {
  for (const entry of readdirSync(yearPath, { withFileTypes: true })) {
    if (fromScheme === "compact" && !entry.isDirectory() && /^\d{2}-\d{2}\.md$/.test(entry.name)) {
      const targetSeg = remapDatePath("compact", year, [entry.name.replace(/\.md$/, "")], toScheme);
      if (!targetSeg) continue;
      moves.push({
        from: join(yearPath, entry.name),
        to: `${join(basePath, targetSeg)}.md`,
        type: "journal-file",
      });
    } else if (NUM_NAME_PATTERN.test(entry.name) && entry.isDirectory()) {
      const entryPath = join(yearPath, entry.name);
      for (const dayEntry of readdirSync(entryPath)) {
        const dayPath = join(entryPath, dayEntry);

        if (fromScheme === "calendar" && /^\d{2}-[A-Z][a-z]+\.md$/.test(dayEntry)) {
          const targetSeg = remapDatePath(
            "calendar",
            year,
            [entry.name, dayEntry.replace(/\.md$/, "")],
            toScheme,
          );
          if (!targetSeg) continue;
          moves.push({
            from: dayPath,
            to: `${join(basePath, targetSeg)}.md`,
            type: "journal-file",
          });
        } else if (fromScheme === "monthly" && /^\d{2}\.md$/.test(dayEntry)) {
          const targetSeg = remapDatePath(
            "monthly",
            year,
            [entry.name, dayEntry.replace(/\.md$/, "")],
            toScheme,
          );
          if (!targetSeg) continue;
          moves.push({
            from: dayPath,
            to: `${join(basePath, targetSeg)}.md`,
            type: "journal-file",
          });
        }
      }
    }
  }
}

/** Execute a list of moves, creating target directories as needed. Returns count of moves executed.
 *  When the target already exists, plan directories are merged (source entries that
 *  don't exist in the target are copied over) and journal files are skipped. */
export function executeMoves(moves: MoveEntry[]): number {
  let count = 0;
  for (const move of moves) {
    if (move.from === move.to) continue;
    mkdirSync(dirname(move.to), { recursive: true });

    if (existsSync(move.to)) {
      if (move.type === "plan-dir") {
        for (const entry of readdirSync(move.from)) {
          const src = join(move.from, entry);
          const dest = join(move.to, entry);
          if (!existsSync(dest)) {
            cpSync(src, dest, { recursive: true });
          }
        }
        rmSync(move.from, { recursive: true });
      }
      // journal-file: target is newer — skip, cleanEmptyDirs handles the rest
    } else {
      renameSync(move.from, move.to);
    }
    count++;
  }
  return count;
}

/** Remove empty directories by walking up from leaf paths. */
export function cleanEmptyDirs(paths: string[], stopAt: string): number {
  let removed = 0;
  const seen = new Set<string>();

  for (const p of paths) {
    let dir = dirname(p);
    while (dir.length > stopAt.length && !seen.has(dir)) {
      seen.add(dir);
      try {
        const entries = readdirSync(dir);
        if (entries.length === 0) {
          rmdirSync(dir);
          removed++;
          dir = dirname(dir);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
  return removed;
}
