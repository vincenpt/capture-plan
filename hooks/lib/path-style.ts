// path-style.ts — Vault path layout patterns and predicates

/** Matches NNN-slug plan directories (e.g. "001-my-plan"). */
export const PLAN_DIR_PATTERN = /^(\d{3,})-(.+)$/

/** Matches four-digit year directories (e.g. "2026"). */
export const YEAR_PATTERN = /^\d{4}$/

/** Matches flat date directories (e.g. "2026-04-03"). */
export const FLAT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Matches compact mm-dd date entries (e.g. "04-03"). */
export const COMPACT_DATE_PATTERN = /^\d{2}-\d{2}$/

/** Matches mm-MonthName or dd-DayName entries (e.g. "04-April", "03-Friday"). */
export const NUM_NAME_PATTERN = /^\d{2}-[A-Z][a-z]+$/

/** Matches bare two-digit day entries (e.g. "03"). */
export const DAY_ONLY_PATTERN = /^\d{2}$/

/** e.g. "001-my-plan" */
export function isPlanDir(name: string): boolean {
  return PLAN_DIR_PATTERN.test(name)
}

/** e.g. "2026" */
export function isYearDir(name: string): boolean {
  return YEAR_PATTERN.test(name)
}

/** e.g. "2026-04-03" */
export function isFlatDateDir(name: string): boolean {
  return FLAT_DATE_PATTERN.test(name)
}

/** e.g. "04-03" */
export function isCompactDateDir(name: string): boolean {
  return COMPACT_DATE_PATTERN.test(name)
}

/** e.g. "04-April", "03-Friday" */
export function isNumNameDir(name: string): boolean {
  return NUM_NAME_PATTERN.test(name)
}

/** e.g. "03" */
export function isDayOnlyDir(name: string): boolean {
  return DAY_ONLY_PATTERN.test(name)
}

/** Matches flat date markdown files (e.g. "2026-04-03.md"). */
const FLAT_DATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/

/** Matches compact mm-dd markdown files (e.g. "04-03.md"). */
const COMPACT_DATE_FILE_PATTERN = /^\d{2}-\d{2}\.md$/

/** Matches mm-Name or dd-Name markdown files (e.g. "04-April.md", "03-Friday.md"). */
const NUM_NAME_FILE_PATTERN = /^\d{2}-[A-Z][a-z]+\.md$/

/** Matches bare two-digit day markdown files (e.g. "03.md"). */
const DAY_ONLY_FILE_PATTERN = /^\d{2}\.md$/

/** e.g. "2026-04-03.md" */
export function isFlatDateFile(name: string): boolean {
  return FLAT_DATE_FILE_PATTERN.test(name)
}

/** e.g. "04-03.md" */
export function isCompactDateFile(name: string): boolean {
  return COMPACT_DATE_FILE_PATTERN.test(name)
}

/** e.g. "04-April.md" */
export function isNumNameFile(name: string): boolean {
  return NUM_NAME_FILE_PATTERN.test(name)
}

/** e.g. "03.md" */
export function isDayOnlyFile(name: string): boolean {
  return DAY_ONLY_FILE_PATTERN.test(name)
}
