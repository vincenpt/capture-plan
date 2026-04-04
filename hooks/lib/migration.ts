// migration.ts — Vault layout detection and migration utilities

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type DateScheme, formatDatePath, getDatePartsFor } from "./dates.ts";

const YEAR_PATTERN = /^\d{4}$/;
const PLAN_DIR_PATTERN = /^(\d{3,})-(.+)$/;

/** Classify a directory entry under a year dir into its date scheme. */
export function classifyDateEntry(entry: string, children?: string[]): DateScheme | undefined {
  // flat: yyyy-mm-dd (entry IS the flat date, lives at base level, but we're under year)
  // — flat entries are yyyy-mm-dd and live directly under the base, not under year dirs
  // So if we're scanning under a year dir, flat doesn't apply here.

  // compact: mm-dd
  if (/^\d{2}-\d{2}$/.test(entry)) return "compact";

  // calendar or monthly: mm-MonthName
  if (/^\d{2}-[A-Z][a-z]+$/.test(entry) && children) {
    // Check children to distinguish calendar (dd-DayName) from monthly (dd)
    for (const child of children) {
      if (/^\d{2}-[A-Z][a-z]+$/.test(child)) return "calendar";
      if (/^\d{2}$/.test(child)) return "monthly";
    }
  }

  return undefined;
}

/** Scan a vault path to detect which date schemes are present on disk. */
export function detectVaultSchemes(basePath: string): Set<DateScheme> {
  const schemes = new Set<DateScheme>();

  // Check for flat entries (yyyy-mm-dd) directly under base path
  try {
    for (const entry of readdirSync(basePath)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
        const fullPath = join(basePath, entry);
        if (isDir(fullPath)) {
          schemes.add("flat");
          break;
        }
      }
    }
  } catch {
    /* base path doesn't exist */
  }

  // Check under year directories
  try {
    for (const yearEntry of readdirSync(basePath)) {
      if (!YEAR_PATTERN.test(yearEntry)) continue;
      const yearPath = join(basePath, yearEntry);
      if (!isDir(yearPath)) continue;

      for (const dateEntry of readdirSync(yearPath)) {
        const datePath = join(yearPath, dateEntry);
        if (!isDir(datePath)) continue;

        let children: string[] | undefined;
        try {
          children = readdirSync(datePath).filter((c) => isDir(join(datePath, c)));
        } catch {
          /* skip */
        }

        const scheme = classifyDateEntry(dateEntry, children);
        if (scheme) schemes.add(scheme);
      }
    }
  } catch {
    /* base path doesn't exist */
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
    // Flat scheme embeds the full date in segments[0]
    if (scheme === "flat") {
      const parts = segments[0].split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0);
    }

    const y = parseInt(year, 10);
    switch (scheme) {
      case "compact": {
        // segments[0] = "mm-dd"
        const [mm, dd] = segments[0].split("-").map(Number);
        return new Date(y, mm - 1, dd, 12, 0);
      }
      case "calendar": {
        // segments[0] = "mm-MonthName", segments[1] = "dd-DayName"
        const mm = parseInt(segments[0].split("-")[0], 10);
        const dd = parseInt(segments[1].split("-")[0], 10);
        return new Date(y, mm - 1, dd, 12, 0);
      }
      case "monthly": {
        // segments[0] = "mm-MonthName", segments[1] = "dd"
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
    // Flat entries are directly under basePath
    try {
      for (const entry of readdirSync(basePath)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
        const entryPath = join(basePath, entry);
        if (!isDir(entryPath)) continue;

        const date = parseDateFromPath("flat", "", [entry]);
        if (!date) continue;
        const parts = getDatePartsFor(date);
        const targetSeg = formatDatePath(toScheme, parts);
        const targetPath = join(basePath, targetSeg);

        for (const planEntry of readdirSync(entryPath)) {
          if (isHidden(planEntry)) continue;
          moves.push({
            from: join(entryPath, planEntry),
            to: join(targetPath, planEntry),
            type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
          });
        }
      }
    } catch {
      /* skip */
    }
    return moves;
  }

  // Non-flat: entries are under year dirs
  try {
    for (const yearEntry of readdirSync(basePath)) {
      if (!YEAR_PATTERN.test(yearEntry)) continue;
      const yearPath = join(basePath, yearEntry);
      if (!isDir(yearPath)) continue;

      collectPlanMovesUnderYear(yearPath, yearEntry, fromScheme, toScheme, basePath, moves);
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
  for (const dateEntry of readdirSync(yearPath)) {
    const datePath = join(yearPath, dateEntry);
    if (!isDir(datePath)) continue;

    if (fromScheme === "compact" && /^\d{2}-\d{2}$/.test(dateEntry)) {
      const date = parseDateFromPath("compact", year, [dateEntry]);
      if (!date) continue;
      const parts = getDatePartsFor(date);
      const targetSeg = formatDatePath(toScheme, parts);

      for (const planEntry of readdirSync(datePath)) {
        if (isHidden(planEntry)) continue;
        moves.push({
          from: join(datePath, planEntry),
          to: join(basePath, targetSeg, planEntry),
          type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
        });
      }
    } else if (
      (fromScheme === "calendar" || fromScheme === "monthly") &&
      /^\d{2}-[A-Z][a-z]+$/.test(dateEntry)
    ) {
      for (const dayEntry of readdirSync(datePath)) {
        const dayPath = join(datePath, dayEntry);
        if (!isDir(dayPath)) continue;

        const isCalendar = /^\d{2}-[A-Z][a-z]+$/.test(dayEntry);
        const isMonthly = /^\d{2}$/.test(dayEntry);

        if ((fromScheme === "calendar" && isCalendar) || (fromScheme === "monthly" && isMonthly)) {
          const date = parseDateFromPath(fromScheme, year, [dateEntry, dayEntry]);
          if (!date) continue;
          const parts = getDatePartsFor(date);
          const targetSeg = formatDatePath(toScheme, parts);

          for (const planEntry of readdirSync(dayPath)) {
            if (isHidden(planEntry)) continue;
            moves.push({
              from: join(dayPath, planEntry),
              to: join(basePath, targetSeg, planEntry),
              type: PLAN_DIR_PATTERN.test(planEntry) ? "plan-dir" : "loose",
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
        const date = parseDateFromPath("flat", "", [entry.replace(/\.md$/, "")]);
        if (!date) continue;
        const parts = getDatePartsFor(date);
        const targetSeg = formatDatePath(toScheme, parts);
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
    for (const yearEntry of readdirSync(basePath)) {
      if (!YEAR_PATTERN.test(yearEntry)) continue;
      const yearPath = join(basePath, yearEntry);
      if (!isDir(yearPath)) continue;

      collectJournalMovesUnderYear(yearPath, yearEntry, fromScheme, toScheme, basePath, moves);
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
  for (const entry of readdirSync(yearPath)) {
    const entryPath = join(yearPath, entry);

    if (fromScheme === "compact" && /^\d{2}-\d{2}\.md$/.test(entry)) {
      // compact journal: yyyy/mm-dd.md
      const date = parseDateFromPath("compact", year, [entry.replace(/\.md$/, "")]);
      if (!date) continue;
      const parts = getDatePartsFor(date);
      const targetSeg = formatDatePath(toScheme, parts);
      moves.push({
        from: entryPath,
        to: `${join(basePath, targetSeg)}.md`,
        type: "journal-file",
      });
    } else if (/^\d{2}-[A-Z][a-z]+$/.test(entry) && isDir(entryPath)) {
      // calendar or monthly: yyyy/mm-MonthName/...
      for (const dayEntry of readdirSync(entryPath)) {
        const dayPath = join(entryPath, dayEntry);

        if (fromScheme === "calendar" && /^\d{2}-[A-Z][a-z]+\.md$/.test(dayEntry)) {
          const date = parseDateFromPath("calendar", year, [entry, dayEntry.replace(/\.md$/, "")]);
          if (!date) continue;
          const parts = getDatePartsFor(date);
          const targetSeg = formatDatePath(toScheme, parts);
          moves.push({
            from: dayPath,
            to: `${join(basePath, targetSeg)}.md`,
            type: "journal-file",
          });
        } else if (fromScheme === "monthly" && /^\d{2}\.md$/.test(dayEntry)) {
          const date = parseDateFromPath("monthly", year, [entry, dayEntry.replace(/\.md$/, "")]);
          if (!date) continue;
          const parts = getDatePartsFor(date);
          const targetSeg = formatDatePath(toScheme, parts);
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

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}
