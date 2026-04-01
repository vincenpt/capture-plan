// text.ts — Pure string/text transformation helpers

import { appendFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { TokenUsage } from "../transcript.ts";

// ---- Debug Logging ----

export function debugLog(msg: string, logFile: string): void {
  try {
    appendFileSync(logFile, msg);
  } catch {
    /* ignore */
  }
}

// ---- Slug & Title ----

export function extractTitle(content: string): string {
  for (const rawLine of content.split("\n")) {
    const line = rawLine
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^plan:\s*/i, "")
      .replace(/[`*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line) return line;
  }
  return "Unnamed Plan";
}

export function toSlug(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > 80) {
    const parts = slug.split("-");
    const kept: string[] = [];
    let total = 0;
    for (const part of parts) {
      const extra = part.length + (kept.length ? 1 : 0);
      if (total + extra > 80) break;
      kept.push(part);
      total += extra;
    }
    slug = kept.join("-") || slug;
  }
  return slug || "unnamed-plan";
}

export function stripTitleLine(content: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i]
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^plan:\s*/i, "")
      .replace(/[`*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped) {
      const rest = lines.slice(i + 1);
      while (rest.length > 0 && !rest[0].trim()) rest.shift();
      return rest.join("\n");
    }
  }
  return content;
}

// ---- Tags ----

export function formatTagsYaml(tagsCsv: string): string {
  const tags = tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) return "";
  return tags.map((t) => `  - ${t}`).join("\n");
}

export function mergeTags(existing: string[], newTagsCsv: string): string {
  const newTags = newTagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...existing, ...newTags]) {
    const t = tag.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      merged.push(t);
    }
  }
  return merged.join(",");
}

// ---- Project & Session Helpers ----

export function getProjectName(cwd?: string): string {
  if (!cwd) return "";
  return basename(cwd);
}

export function getProjectLabel(cwd?: string): string {
  if (!cwd) return "unknown";
  const base = basename(cwd);
  const parent = basename(dirname(cwd));
  return parent && parent !== "." ? `${parent}/${base}` : base;
}

export function shortSessionId(id: string): string {
  return id.slice(0, 8);
}

// ---- Number Formatting ----

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function padCounter(n: number): string {
  return String(n).padStart(3, "0");
}

// ---- Tool Log Helpers ----

export function escapeTableCell(val: string): string {
  return val.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

const CODE_LIKE_KEYS = new Set([
  "subagent_type",
  "language",
  "output_mode",
  "type",
  "isolation",
  "model",
]);

export function isCodeLike(key: string, val: string): boolean {
  if (CODE_LIKE_KEYS.has(key)) return true;
  if (/^[~/.]/.test(val) || val.startsWith("..")) return true;
  if (val.includes("*")) return true;
  if (/\.\w{1,5}$/.test(val) && !val.includes(" ")) return true;
  return false;
}

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".sh": "sh",
  ".bash": "bash",
  ".zsh": "zsh",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".css": "css",
  ".html": "html",
  ".sql": "sql",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".swift": "swift",
};

export function langFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "";
  return EXT_TO_LANG[filePath.slice(dot)] ?? "";
}

// ---- Context Helpers ----

export function computeContextPct(tokens: TokenUsage, contextCap: number): number {
  if (contextCap <= 0) return 0;
  return Math.round(((tokens.input + tokens.output) / contextCap) * 100);
}

export function contextCapLabel(cap: number): string {
  if (cap >= 1_000_000 && cap % 1_000_000 === 0) return `${cap / 1_000_000}M`;
  return `${Math.round(cap / 1_000)}K`;
}

export function formatCcVersionYaml(ccVersion?: string): string {
  if (!ccVersion) return "";
  return `\ncc_version: "${ccVersion}"`;
}
