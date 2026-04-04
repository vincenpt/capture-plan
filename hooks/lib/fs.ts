// fs.ts — Shared filesystem helpers and vault path patterns

import { readdirSync, statSync } from "node:fs";

/** Read a directory returning entry names, or empty array on error. */
export function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Check whether a path is a directory. */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// -- Vault path patterns --

/** Matches NNN-slug plan directories (e.g. "001-my-plan"). */
export const PLAN_DIR_PATTERN = /^(\d{3,})-(.+)$/;

/** Matches four-digit year directories (e.g. "2026"). */
export const YEAR_PATTERN = /^\d{4}$/;

/** Matches flat date directories (e.g. "2026-04-03"). */
export const FLAT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Matches compact mm-dd date entries (e.g. "04-03"). */
export const COMPACT_DATE_PATTERN = /^\d{2}-\d{2}$/;

/** Matches mm-MonthName or dd-DayName entries (e.g. "04-April", "03-Friday"). */
export const NUM_NAME_PATTERN = /^\d{2}-[A-Z][a-z]+$/;

/** Matches bare two-digit day entries (e.g. "03"). */
export const DAY_ONLY_PATTERN = /^\d{2}$/;
