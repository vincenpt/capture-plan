// toml-writer.ts — Minimal TOML patcher for updating single keys within tables

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** Format a value as a TOML literal. */
function formatValue(value: boolean | number | string): string {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * Update a single key within a TOML `[table]`. Creates the file, table,
 * or key if absent. Preserves all other content and comments.
 */
export function setTomlValue(
  filePath: string,
  table: string,
  key: string,
  value: boolean | number | string,
): void {
  const formatted = formatValue(value)
  const keyLine = `${key} = ${formatted}`

  let content = ""
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf8")
  }

  const lines = content.split("\n")
  const tableHeader = `[${table}]`
  let tableIdx = -1

  // Find the [table] header line
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === tableHeader) {
      tableIdx = i
      break
    }
  }

  if (tableIdx === -1) {
    // Table not found — append it
    const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
    const separator = content.length > 0 ? "\n" : ""
    content = `${content}${suffix}${separator}${tableHeader}\n${keyLine}\n`
  } else {
    // Scan lines after the header for the key or the next table
    let keyIdx = -1
    let insertIdx = tableIdx + 1 // default: right after header

    for (let i = tableIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      // Hit the next table header — stop
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) break
      insertIdx = i + 1
      // Check if this line sets our key
      const match = trimmed.match(/^(\w[\w-]*)\s*=/)
      if (match && match[1] === key) {
        keyIdx = i
        break
      }
    }

    if (keyIdx !== -1) {
      // Replace existing key line
      lines[keyIdx] = keyLine
    } else {
      // Insert after the last line in this table section
      lines.splice(insertIdx, 0, keyLine)
    }
    content = lines.join("\n")
  }

  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content)
}
