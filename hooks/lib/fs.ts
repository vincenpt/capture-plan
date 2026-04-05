// fs.ts — Shared filesystem helpers

import { readdirSync, statSync } from "node:fs"

/** Read a directory returning entry names, or empty array on error. */
export function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** Check whether a path is a directory. */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
