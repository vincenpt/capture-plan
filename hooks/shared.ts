#!/usr/bin/env bun
// shared.ts — Shared utilities for capture-plan and capture-done hooks

import { appendFileSync, mkdirSync, rmdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ---- Types ----

export interface Config {
  vault?: string;
  plan_path: string;
  journal_path: string;
}

export interface SessionState {
  session_id: string;
  plan_slug: string;
  plan_title: string;
  plan_dir: string;
  counter: number;
  date_key: string;
  timestamp: string;
  journal_path?: string;
}

// ---- Paths ----

export const HOOKS_DIR = dirname(Bun.main);
export const PLUGIN_ROOT = dirname(HOOKS_DIR);
export let STATE_DIR = join(HOOKS_DIR, "state");

/** @internal Test-only setter for STATE_DIR */
export function _setStateDirForTest(dir: string): void {
  STATE_DIR = dir;
}
const PLUGIN_DEFAULT_CONFIG = join(PLUGIN_ROOT, "capture-plan.toml");
const USER_GLOBAL_CONFIG = join(homedir(), ".config", "capture-plan", "config.toml");

const DEFAULT_CONFIG: Config = {
  plan_path: "Claude/Plans",
  journal_path: "Journal",
};

// ---- Debug Logging ----

export function debugLog(msg: string, logFile: string): void {
  try {
    appendFileSync(logFile, msg);
  } catch { /* ignore */ }
}

// ---- Config ----

async function loadToml(path: string): Promise<Record<string, unknown> | null> {
  try {
    const loaded = await import(path);
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

export async function loadConfig(cwd?: string): Promise<Config> {
  const pluginDefault = await loadToml(PLUGIN_DEFAULT_CONFIG);
  const userGlobal = await loadToml(USER_GLOBAL_CONFIG);
  const projectPath = cwd ? join(cwd, ".claude", "capture-plan.toml") : null;
  const project = projectPath ? await loadToml(projectPath) : null;
  const merged = { ...pluginDefault, ...userGlobal, ...project };
  return {
    vault: (merged.vault as string) || undefined,
    plan_path: (merged.plan_path as string) || DEFAULT_CONFIG.plan_path,
    journal_path: (merged.journal_path as string) || DEFAULT_CONFIG.journal_path,
  };
}

// ---- Obsidian CLI ----

export function runObsidian(
  args: string[],
  vault?: string,
): { stdout: string; exitCode: number } {
  try {
    const cmd = vault
      ? ["obsidian", `vault=${vault}`, ...args]
      : ["obsidian", ...args];
    const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return { stdout: result.stdout.toString().trim(), exitCode: result.exitCode };
  } catch {
    return { stdout: "", exitCode: 1 };
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

// ---- Date Helpers ----

export function formatAmPm(hours: number, minutes: number): string {
  const period = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function getDateParts(): {
  dd: string;
  mm: string;
  yyyy: string;
  monthName: string;
  dateKey: string;
  hh: string;
  min: string;
  datetime: string;
  timeStr: string;
  ampmTime: string;
} {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now);
  return {
    dd, mm, yyyy, monthName, hh, min,
    dateKey: `${yyyy}-${mm}-${dd}`,
    datetime: `${yyyy}-${mm}-${dd}T${hh}:${min}`,
    timeStr: `${hh}:${min}`,
    ampmTime: formatAmPm(now.getHours(), now.getMinutes()),
  };
}

// ---- Haiku Summarization ----

export async function summarizeWithClaude(
  content: string,
  systemPrompt: string,
): Promise<{ summary: string; tags: string }> {
  let summary = "";
  let tags = "";

  try {
    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--bare",
        "--max-turns",
        "1",
        "--model",
        "claude-haiku-4-5-20251001",
        "--output-format",
        "text",
        "--system-prompt",
        systemPrompt,
        "Summarise and tag this content:",
      ],
      { stdin: new Blob([content]), stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && !output.toLowerCase().includes("not logged in")) {
      const lines = output.trim().split("\n").filter(Boolean);
      if (lines.length >= 1) summary = lines[0].trim();
      if (lines.length >= 2) tags = lines[lines.length - 1].trim();
    }
  } catch { /* fallback below */ }

  if (!summary || summary.length > 300) {
    summary = content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^(?:#+\s*|\|.*\|$|\s*[-*]\s+)/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (!summary) summary = "Captured from Claude Code session.";
  }
  if (!tags) tags = "claude-session";
  summary = summary.replace(/\n/g, " ").trim();
  return { summary, tags };
}

// ---- Tags ----

export function mergeTags(existing: string[], newTagsCsv: string): string {
  const newTags = newTagsCsv.split(",").map((t) => t.trim()).filter(Boolean);
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

export function mergeTagsOnDailyNote(
  newTags: string,
  journalPath: string,
  vault?: string,
): void {
  if (!journalPath) return;
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const tagsResult = runObsidian(
    ["property:read", `name=tags`, `path=${pathWithExt}`],
    vault,
  );
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

// ---- Daily Journal ----

export function getJournalPath(config: Config): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now);
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  return `${config.journal_path}/${yyyy}/${mm}-${monthName}/${dd}-${dayName}`;
}

export function appendToJournal(
  content: string,
  journalPath: string,
  vault?: string,
): void {
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const result = runObsidian(
    ["append", `path=${pathWithExt}`, `content=${content}`],
    vault,
  );
  if (result.exitCode !== 0) {
    // File doesn't exist yet — create it, then append
    runObsidian(["create", `path=${journalPath}`, "content= ", "silent"], vault);
    runObsidian(["append", `path=${pathWithExt}`, `content=${content}`], vault);
  }
}

// ---- Vault Path ----

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

// ---- Journal Section Append ----

export async function appendRowToJournalSection(
  planTitle: string,
  tableRow: string,
  journalFilePath: string,
): Promise<boolean> {
  try {
    const content = await Bun.file(journalFilePath).text();
    const lines = content.split("\n");

    // Find ### Plan Title header
    const headerPattern = `### ${planTitle}`;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === headerPattern) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return false;

    // Find last table row in this section (before next ### or EOF)
    let lastTableRowIdx = -1;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) break;
      if (lines[i].trim().startsWith("|") && !lines[i].trim().startsWith("|---")) {
        lastTableRowIdx = i;
      }
    }
    if (lastTableRowIdx === -1) return false;

    lines.splice(lastTableRowIdx + 1, 0, tableRow);
    await Bun.write(journalFilePath, lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

// ---- Counter (per-day, mkdir-locked) ----

export async function nextCounter(dateKey: string): Promise<number> {
  const counterDir = join(STATE_DIR, "counters");
  const counterFile = join(counterDir, `${dateKey}.json`);
  const lockDir = join(counterDir, `${dateKey}.lock`);

  mkdirSync(counterDir, { recursive: true });

  // Clean up stale locks (older than 30 seconds)
  try {
    const lockStat = statSync(lockDir);
    if (Date.now() - lockStat.mtimeMs > 30_000) {
      try { rmdirSync(lockDir); } catch { /* */ }
    }
  } catch { /* lock doesn't exist, good */ }

  const maxWait = 5000;
  const start = Date.now();
  let locked = false;
  while (Date.now() - start < maxWait) {
    try {
      mkdirSync(lockDir);
      locked = true;
      break;
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        await Bun.sleep(50);
      } else {
        break;
      }
    }
  }

  try {
    let current = 0;
    try {
      current = JSON.parse(await Bun.file(counterFile).text()).value || 0;
    } catch { /* first use */ }
    const next = current + 1;
    await Bun.write(counterFile, JSON.stringify({ value: next }));
    return next;
  } finally {
    if (locked) {
      try { rmdirSync(lockDir); } catch { /* */ }
    }
  }
}

export function padCounter(n: number): string {
  return String(n).padStart(3, "0");
}

// ---- Session State ----

export async function writeSessionState(
  sessionId: string,
  state: SessionState,
): Promise<void> {
  const path = join(STATE_DIR, "sessions", `${sessionId}.json`);
  await Bun.write(path, JSON.stringify(state));
}

export async function readSessionState(
  sessionId: string,
): Promise<SessionState | null> {
  try {
    const path = join(STATE_DIR, "sessions", `${sessionId}.json`);
    return JSON.parse(await Bun.file(path).text()) as SessionState;
  } catch {
    return null;
  }
}

export function deleteSessionState(sessionId: string): void {
  try {
    const path = join(STATE_DIR, "sessions", `${sessionId}.json`);
    Bun.spawnSync(["rm", "-f", path]);
  } catch { /* ignore */ }
}

// ---- Transcript ----

export function findTranscriptPath(
  sessionId: string,
  cwd?: string,
): string | null {
  const projectsDir = join(homedir(), ".claude", "projects");

  // Try cwd-derived project slug first
  if (cwd) {
    const slug = "-" + cwd.replace(/\//g, "-");
    const p = join(projectsDir, slug, `${sessionId}.jsonl`);
    try {
      if (Bun.file(p).size > 0) return p;
    } catch { /* */ }
  }

  // Fallback: scan all project directories
  try {
    for (const dir of readdirSync(projectsDir)) {
      const p = join(projectsDir, dir, `${sessionId}.jsonl`);
      try {
        if (Bun.file(p).size > 0) return p;
      } catch { /* */ }
    }
  } catch { /* */ }

  return null;
}
