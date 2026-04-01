#!/usr/bin/env bun
// shared.ts — Shared utilities for capture-plan and capture-done hooks

import { appendFileSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  McpServerInfo,
  TokenUsage,
  ToolLog,
  ToolUseRecord,
  TranscriptStats,
} from "./transcript.ts";

// ---- Types ----

export interface Config {
  vault?: string;
  plan_path: string;
  journal_path: string;
  context_cap?: number;
}

export interface SessionState {
  session_id: string;
  plan_slug: string;
  plan_title: string;
  plan_dir: string;
  date_key: string;
  timestamp: string;
  journal_path?: string;
  project?: string;
  tags?: string;
  model?: string;
  cc_version?: string;
  planStats?: TranscriptStats;
}

export interface PlanFrontmatter {
  created?: string;
  journalPath?: string;
  datetime?: string;
  status?: string;
  tags?: string[];
  counter?: number;
  session?: string;
  project?: string;
  source_slug?: string;
}

// ---- Paths ----

export const HOOKS_DIR = dirname(Bun.main);
export const PLUGIN_ROOT = dirname(HOOKS_DIR);

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
  } catch {
    /* ignore */
  }
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
  const rawCap = merged.context_cap;
  const contextCap = typeof rawCap === "number" && rawCap > 0 ? rawCap : undefined;
  return {
    vault: (merged.vault as string) || undefined,
    plan_path: (merged.plan_path as string) || DEFAULT_CONFIG.plan_path,
    journal_path: (merged.journal_path as string) || DEFAULT_CONFIG.journal_path,
    context_cap: contextCap,
  };
}

// ---- Obsidian CLI ----

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

export type DateParts = {
  dd: string;
  mm: string;
  yyyy: string;
  monthName: string;
  dayName: string;
  dateKey: string;
  hh: string;
  min: string;
  datetime: string;
  timeStr: string;
  ampmTime: string;
};

export function getDatePartsFor(date: Date): DateParts {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  return {
    dd,
    mm,
    yyyy,
    monthName,
    dayName,
    hh,
    min,
    dateKey: `${yyyy}-${mm}-${dd}`,
    datetime: `${yyyy}-${mm}-${dd}T${hh}:${min}`,
    timeStr: `${hh}:${min}`,
    ampmTime: formatAmPm(date.getHours(), date.getMinutes()),
  };
}

export function getDateParts(): DateParts {
  return getDatePartsFor(new Date());
}

// ---- Duration Formatting ----

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
  return `${hours}h`;
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
  } catch {
    /* fallback below */
  }

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

export function formatTagsYaml(tagsCsv: string): string {
  const tags = tagsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) return "";
  return tags.map((t) => `  - ${t}`).join("\n");
}

// ---- Tags ----

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

// ---- Daily Journal ----

export function getJournalPathForDate(config: Config, date: Date): string {
  const { dd, mm, yyyy, monthName, dayName } = getDatePartsFor(date);
  return `${config.journal_path}/${yyyy}/${mm}-${monthName}/${dd}-${dayName}`;
}

export function getJournalPath(config: Config): string {
  return getJournalPathForDate(config, new Date());
}

export function appendToJournal(content: string, journalPath: string, vault?: string): void {
  const pathWithExt = journalPath.endsWith(".md") ? journalPath : `${journalPath}.md`;
  const result = runObsidian(["append", `path=${pathWithExt}`, `content=${content}`], vault);
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

export function nextCounter(dateDirPath: string): number {
  try {
    const entries = readdirSync(dateDirPath);
    let max = 0;
    for (const entry of entries) {
      const match = entry.match(/^(\d{3,})-/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    return max + 1;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")
      return 1;
    throw err;
  }
}

export function padCounter(n: number): string {
  return String(n).padStart(3, "0");
}

// ---- Session State (Vault-based) ----

const STALE_STATE_MS = 2 * 60 * 60 * 1000; // 2 hours

function serializeStateToFrontmatter(state: SessionState): string {
  const lines: string[] = ["---"];
  lines.push(`session_id: "${state.session_id}"`);
  lines.push(`plan_slug: "${state.plan_slug}"`);
  lines.push(`plan_title: "${state.plan_title.replace(/"/g, '\\"')}"`);
  lines.push(`plan_dir: "${state.plan_dir}"`);
  lines.push(`date_key: "${state.date_key}"`);
  lines.push(`timestamp: "${state.timestamp}"`);
  if (state.journal_path) lines.push(`journal_path: "${state.journal_path}"`);
  if (state.project) lines.push(`project: "${state.project}"`);
  if (state.tags) lines.push(`tags: "${state.tags}"`);
  if (state.model) lines.push(`model: "${state.model}"`);
  if (state.cc_version) lines.push(`cc_version: "${state.cc_version}"`);
  if (state.planStats) {
    const json = JSON.stringify(state.planStats).replace(/"/g, '\\"');
    lines.push(`plan_stats_json: "${json}"`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseStateFromFrontmatter(content: string): SessionState | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  const get = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*"(.*)"\\s*$`, "m"));
    return m ? m[1] : undefined;
  };

  const sessionId = get("session_id");
  const planSlug = get("plan_slug");
  const planTitle = get("plan_title");
  const planDir = get("plan_dir");
  const dateKey = get("date_key");
  const timestamp = get("timestamp");
  if (!sessionId || !planSlug || !planTitle || !planDir || !dateKey || !timestamp) return null;

  const state: SessionState = {
    session_id: sessionId,
    plan_slug: planSlug,
    plan_title: planTitle.replace(/\\"/g, '"'),
    plan_dir: planDir,
    date_key: dateKey,
    timestamp,
    journal_path: get("journal_path"),
    project: get("project"),
    tags: get("tags"),
    model: get("model"),
    cc_version: get("cc_version"),
  };

  const statsJson = get("plan_stats_json");
  if (statsJson) {
    try {
      state.planStats = JSON.parse(statsJson.replace(/\\"/g, '"')) as TranscriptStats;
    } catch {
      /* ignore malformed stats */
    }
  }

  return state;
}

export function writeVaultState(state: SessionState, vault?: string): boolean {
  const content = serializeStateToFrontmatter(state);
  const escaped = content.replace(/\n/g, "\\n");
  const result = runObsidian(
    ["create", `path=${state.plan_dir}/state`, `content=${escaped}`, "silent"],
    vault,
  );
  return result.exitCode === 0;
}

export function scanForVaultState(sessionId: string, config: Config): SessionState | null {
  const vaultPath = getVaultPath(config.vault);
  if (!vaultPath) return null;

  const planRoot = join(vaultPath, config.plan_path);
  let match: SessionState | null = null;

  // State files expire in 2h, so only scan today + yesterday (covers midnight crossover)
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const recentDirs = [today, yesterday].map((d) => {
    const parts = getDatePartsFor(d);
    return { year: parts.yyyy, date: `${parts.mm}-${parts.dd}` };
  });

  for (const { year, date } of recentDirs) {
    const datePath = join(planRoot, year, date);
    try {
      for (const planDir of readdirSync(datePath, { withFileTypes: true })) {
        if (!planDir.isDirectory()) continue;
        const stateFile = join(datePath, planDir.name, "state.md");
        try {
          const text = readFileSync(stateFile, "utf8");
          if (!text) continue;
          const state = parseStateFromFrontmatter(text);
          if (!state) continue;

          // Housekeeping: remove stale state files
          const age = Date.now() - new Date(state.timestamp).getTime();
          if (age > STALE_STATE_MS) {
            try {
              unlinkSync(stateFile);
            } catch {
              /* ignore */
            }
            continue;
          }

          if (state.session_id === sessionId) {
            match = state;
          }
        } catch {
          /* file doesn't exist or unreadable — skip */
        }
      }
    } catch {
      /* date directory doesn't exist — skip */
    }
  }

  return match;
}

export function deleteVaultState(planDir: string, vaultPath: string): void {
  try {
    unlinkSync(join(vaultPath, planDir, "state.md"));
  } catch {
    /* ignore */
  }
}

// ---- Plan Frontmatter Parsing ----

export function parsePlanFrontmatter(content: string): PlanFrontmatter {
  const result: PlanFrontmatter = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return result;
  const fm = fmMatch[1];

  // created: "[[Journal/path|datetime]]"
  const createdMatch = fm.match(/^created:\s*"?\[\[([^|]+)\|([^\]]+)\]\]"?/m);
  if (createdMatch) {
    result.created = `[[${createdMatch[1]}|${createdMatch[2]}]]`;
    result.journalPath = createdMatch[1];
    result.datetime = createdMatch[2];
  }

  // status
  const statusMatch = fm.match(/^status:\s*(.+)/m);
  if (statusMatch) result.status = statusMatch[1].trim();

  // counter
  const counterMatch = fm.match(/^counter:\s*(\d+)/m);
  if (counterMatch) result.counter = parseInt(counterMatch[1], 10);

  // session
  const sessionMatch = fm.match(/^session:\s*(.+)/m);
  if (sessionMatch) result.session = sessionMatch[1].trim();

  // project
  const projectMatch = fm.match(/^project:\s*(.+)/m);
  if (projectMatch) result.project = projectMatch[1].trim();

  // source_slug (for backport dedup)
  const sourceSlugMatch = fm.match(/^source_slug:\s*(.+)/m);
  if (sourceSlugMatch) result.source_slug = sourceSlugMatch[1].trim();

  // tags (YAML list format)
  const tagsSection = fm.match(/^tags:\n((?:\s+-\s+.+\n?)*)/m);
  if (tagsSection) {
    result.tags = tagsSection[1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }

  return result;
}

// ---- Context Window ----

const DEFAULT_CONTEXT_CAP = 200_000;

export function contextCapLabel(cap: number): string {
  if (cap >= 1_000_000 && cap % 1_000_000 === 0) return `${cap / 1_000_000}M`;
  return `${Math.round(cap / 1_000)}K`;
}

export interface ContextHintResult {
  context_cap?: number;
  cc_version?: string;
}

export function readContextHint(sessionId: string): ContextHintResult {
  try {
    const hintFile = join(tmpdir(), `capture-plan-context-${sessionId}.json`);
    const raw = readFileSync(hintFile, "utf8");
    const hint = JSON.parse(raw) as { context_cap?: number; cc_version?: string };
    return {
      context_cap:
        typeof hint.context_cap === "number" && hint.context_cap > 0 ? hint.context_cap : undefined,
      cc_version: typeof hint.cc_version === "string" ? hint.cc_version : undefined,
    };
  } catch {
    return {};
  }
}

export function readCcVersion(sessionId: string): string | undefined {
  return readContextHint(sessionId).cc_version;
}

/** Parse Claude Code version from `claude --version` output (e.g. "2.1.89 (Claude Code)"). */
export function parseCcVersion(raw: string): string | undefined {
  const match = raw.trim().match(/^(\d+\.\d+\.\d+)/);
  return match ? `v${match[1]}` : undefined;
}

export function detectCcVersion(): string | undefined {
  try {
    const result = Bun.spawnSync(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    return parseCcVersion(result.stdout.toString());
  } catch {
    return undefined;
  }
}

export function formatCcVersionYaml(ccVersion?: string): string {
  if (!ccVersion) return "";
  return `\ncc_version: "${ccVersion}"`;
}

export function resolveContextCap(
  peakContext: number,
  configCap?: number,
  sessionId?: string,
): number {
  if (configCap && configCap > 0) return configCap;
  if (sessionId) {
    const hint = readContextHint(sessionId);
    if (hint.context_cap) return hint.context_cap;
  }
  if (peakContext > DEFAULT_CONTEXT_CAP) return 1_000_000;
  return DEFAULT_CONTEXT_CAP;
}

export function computeContextPct(tokens: TokenUsage, contextCap: number): number {
  if (contextCap <= 0) return 0;
  return Math.round(((tokens.input + tokens.output) / contextCap) * 100);
}

// ---- Stats Formatting ----

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatStatsYaml(stats: TranscriptStats, contextCap?: number): string {
  const lines: string[] = [];
  const cap = contextCap ?? resolveContextCap(stats.peakTurnContext);
  const capSuffix = ` (${contextCapLabel(cap)})`;
  lines.push(`model: ${stats.model}${capSuffix}`);
  lines.push(`duration: "${formatDuration(stats.durationMs)}"`);
  lines.push(`tokens_in: ${stats.tokens.input}`);
  lines.push(`tokens_out: ${stats.tokens.output}`);
  lines.push(`context_pct: ${computeContextPct(stats.tokens, cap)}`);
  lines.push(`subagents: ${stats.subagentCount}`);
  lines.push(`tools_used: ${stats.totalToolCalls}`);
  lines.push(`total_errors: ${stats.totalErrors}`);
  if (stats.mcpServers.length > 0) {
    lines.push("mcp_servers:");
    for (const srv of stats.mcpServers) {
      lines.push(`  - ${srv.name}`);
    }
  }
  return lines.join("\n");
}

export function formatModelYaml(stats: TranscriptStats | null, contextCap?: number): string {
  if (!stats?.model) return "";
  const cap = contextCap ?? resolveContextCap(stats.peakTurnContext);
  const capSuffix = ` (${contextCapLabel(cap)})`;
  const pct = computeContextPct(stats.tokens, cap);
  return `\nmodel: ${stats.model}${capSuffix}\ncontext_pct: ${pct}`;
}

export function formatToolTable(tools: ToolUseRecord[]): string {
  if (tools.length === 0) return "";
  const lines: string[] = [];
  lines.push("| Tool | Calls | Errors |");
  lines.push("|------|------:|-------:|");
  for (const tool of tools) {
    lines.push(`| ${tool.name} | ${tool.calls} | ${tool.errors} |`);
  }
  return lines.join("\n");
}

export function mergeTranscriptStats(a: TranscriptStats, b: TranscriptStats): TranscriptStats {
  // Merge tokens
  const tokens = {
    input: a.tokens.input + b.tokens.input,
    output: a.tokens.output + b.tokens.output,
    cache_read: a.tokens.cache_read + b.tokens.cache_read,
    cache_create: a.tokens.cache_create + b.tokens.cache_create,
  };

  // Merge tool records — sum calls/errors for same-named tools
  const toolMap = new Map<string, { calls: number; errors: number }>();
  for (const t of [...a.tools, ...b.tools]) {
    const existing = toolMap.get(t.name);
    if (existing) {
      existing.calls += t.calls;
      existing.errors += t.errors;
    } else {
      toolMap.set(t.name, { calls: t.calls, errors: t.errors });
    }
  }
  const tools: ToolUseRecord[] = [...toolMap.entries()]
    .map(([name, rec]) => ({ name, calls: rec.calls, errors: rec.errors }))
    .sort((x, y) => y.calls - x.calls);

  // Merge MCP servers — union tool lists, sum calls
  const mcpMap = new Map<string, { tools: Set<string>; calls: number }>();
  for (const srv of [...a.mcpServers, ...b.mcpServers]) {
    const existing = mcpMap.get(srv.name);
    if (existing) {
      for (const t of srv.tools) existing.tools.add(t);
      existing.calls += srv.calls;
    } else {
      mcpMap.set(srv.name, { tools: new Set(srv.tools), calls: srv.calls });
    }
  }
  const mcpServers: McpServerInfo[] = [...mcpMap.entries()]
    .map(([name, info]) => ({ name, tools: [...info.tools], calls: info.calls }))
    .sort((x, y) => y.calls - x.calls);

  const totalToolCalls = a.totalToolCalls + b.totalToolCalls;
  const totalErrors = a.totalErrors + b.totalErrors;
  const model = a.model !== "unknown" ? a.model : b.model;
  const durationMs = a.durationMs + b.durationMs;

  return {
    model,
    durationMs,
    tokens,
    peakTurnContext: Math.max(a.peakTurnContext, b.peakTurnContext),
    subagentCount: a.subagentCount + b.subagentCount,
    tools,
    mcpServers,
    totalToolCalls,
    totalErrors,
  };
}

export function formatToolsNoteContent(opts: {
  planStats: TranscriptStats | null;
  execStats: TranscriptStats | null;
  planTitle: string;
  planDir: string;
  journalPath: string;
  datetime: string;
  project?: string;
  contextCap?: number;
  ccVersion?: string;
}): string | null {
  const { planStats, execStats, planTitle, planDir, journalPath, datetime, project, contextCap } =
    opts;
  if (!planStats && !execStats) return null;

  // Compute combined stats for frontmatter
  const combined =
    planStats && execStats
      ? mergeTranscriptStats(planStats, execStats)
      : ((planStats ?? execStats) as TranscriptStats);

  const cap = contextCap ?? resolveContextCap(combined.peakTurnContext);
  const statsYaml = formatStatsYaml(combined, cap);

  // Build body sections
  const sections: string[] = [];

  const addPhase = (heading: string, stats: TranscriptStats): void => {
    if (sections.length > 0) sections.push("");
    sections.push(`## ${heading}`);
    sections.push("");
    sections.push(
      `*${formatDuration(stats.durationMs)} — ${formatNumber(stats.totalToolCalls)} tool calls, ${stats.totalErrors} errors*`,
    );
    sections.push("");
    const table = formatToolTable(stats.tools);
    if (table) sections.push(table);
  };

  if (planStats) addPhase("Planning Phase", planStats);
  if (execStats) addPhase("Execution Phase", execStats);

  // Combined summary
  const pct = computeContextPct(combined.tokens, cap);
  sections.push("");
  sections.push("## Combined");
  sections.push("");
  sections.push(
    `**${formatNumber(combined.totalToolCalls)} tool calls** | **${formatNumber(combined.tokens.input)} in / ${formatNumber(combined.tokens.output)} out tokens** | **${combined.totalErrors} errors**`,
  );
  sections.push(
    `**Context: ${formatNumber(combined.tokens.input + combined.tokens.output)} / ${formatNumber(cap)} (${pct}%)**`,
  );

  const body = sections.join("\n");

  const ccVersionYaml = formatCcVersionYaml(opts.ccVersion);

  return `---
created: "[[${journalPath}|${datetime}]]"
plan: "[[${planDir}/plan|${planTitle.replace(/"/g, '\\"')}]]"${project ? `\nproject: ${project}` : ""}${ccVersionYaml}
${statsYaml}
---
# Session Tools: ${planTitle}

${body}
`;
}

// ---- Tool Log Formatting ----

const LARGE_CONTENT_KEYS = new Set(["content", "old_string", "new_string", "code"]);
const ARG_MAX_LEN = 100;
const ARG_PREVIEW_LEN = 60;

export function formatToolArgs(input: Record<string, unknown>): string {
  const lines: string[] = [];
  let commandFence = "";

  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;

    // Bash command → code fence, rendered last
    if (key === "command" && typeof val === "string") {
      commandFence = `\`\`\`sh\n${val}\n\`\`\``;
      continue;
    }

    let display: string;
    if (typeof val === "string") {
      if (LARGE_CONTENT_KEYS.has(key)) {
        display = `[${val.length} chars]`;
      } else if (val.length > ARG_MAX_LEN) {
        display = `${val.slice(0, ARG_PREVIEW_LEN)}… [${val.length} total]`;
      } else {
        display = val;
      }
    } else if (typeof val === "boolean" || typeof val === "number") {
      display = String(val);
    } else {
      const json = JSON.stringify(val);
      display =
        json.length > ARG_MAX_LEN
          ? `${json.slice(0, ARG_PREVIEW_LEN)}… [${json.length} total]`
          : json;
    }
    lines.push(`- ${key}: ${display}`);
  }

  if (commandFence) lines.push(commandFence);

  return lines.join("\n");
}

function formatTimestamp(isoTs: string): string {
  try {
    const d = new Date(isoTs);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m}:${s} ${ampm}`;
  } catch {
    return isoTs;
  }
}

function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatToolsLogContent(opts: {
  planLog: ToolLog | null;
  execLog: ToolLog | null;
  planTitle: string;
  planDir: string;
  journalPath: string;
  datetime: string;
  project?: string;
  contextCap?: number;
  ccVersion?: string;
  model?: string;
}): string | null {
  const { planLog, execLog, planTitle, planDir, journalPath, datetime, project } = opts;
  if (!planLog && !execLog) return null;

  const totalCalls = (planLog?.totalToolCalls ?? 0) + (execLog?.totalToolCalls ?? 0);
  const totalErrors = (planLog?.totalErrors ?? 0) + (execLog?.totalErrors ?? 0);
  const totalTurns = (planLog?.turns.length ?? 0) + (execLog?.turns.length ?? 0);

  // Compute total duration from all turns
  const allTurns = [...(planLog?.turns ?? []), ...(execLog?.turns ?? [])];
  const totalDurationMs = allTurns.reduce((sum, t) => sum + t.durationMs, 0);
  const totalTokensIn = allTurns.reduce((sum, t) => sum + t.tokensIn, 0);
  const totalTokensOut = allTurns.reduce((sum, t) => sum + t.tokensOut, 0);

  // Frontmatter
  const fmLines: string[] = [];
  fmLines.push(`created: "[[${journalPath}|${datetime}]]"`);
  fmLines.push(`plan: "[[${planDir}/plan|${planTitle.replace(/"/g, '\\"')}]]"`);
  if (project) fmLines.push(`project: ${project}`);
  if (opts.ccVersion) fmLines.push(`cc_version: "${opts.ccVersion}"`);
  if (opts.model) fmLines.push(`model: ${opts.model}`);
  fmLines.push(`total_tool_calls: ${totalCalls}`);
  fmLines.push(`total_errors: ${totalErrors}`);
  fmLines.push(`total_turns: ${totalTurns}`);
  if (planLog) fmLines.push(`planning_calls: ${planLog.totalToolCalls}`);
  if (execLog) fmLines.push(`execution_calls: ${execLog.totalToolCalls}`);
  fmLines.push(`duration: "${formatDuration(totalDurationMs)}"`);
  fmLines.push(`tokens_in: ${totalTokensIn}`);
  fmLines.push(`tokens_out: ${totalTokensOut}`);

  // Body
  const sections: string[] = [];

  const renderPhase = (heading: string, log: ToolLog): void => {
    if (sections.length > 0) sections.push("\n---\n");
    sections.push(`## ${heading}\n`);

    for (const turn of log.turns) {
      const tsLabel = turn.timestamp ? formatTimestamp(turn.timestamp) : `Turn ${turn.turnNumber}`;
      const durLabel = formatTurnDuration(turn.durationMs);
      const tokLabel = `${formatNumber(turn.tokensIn)} in · ${formatNumber(turn.tokensOut)} out`;
      const sidechain = turn.isSidechain ? " 🔀" : "";
      sections.push(
        `### Turn ${turn.turnNumber} — ${tsLabel} (${durLabel} | ${tokLabel})${sidechain}\n`,
      );

      if (turn.isSidechain && turn.agentId) {
        sections.push(`> *Subagent: ${turn.agentId}*\n`);
      }

      if (turn.justification) {
        const justLines = turn.justification.split("\n").map((l) => `> ${l}`);
        sections.push(`${justLines.join("\n")}\n`);
      }

      for (const tool of turn.tools) {
        const args = formatToolArgs(tool.input);
        const errorMark = tool.isError ? " ❌" : "";
        sections.push(`${tool.seq}. **${tool.name}**${errorMark}`);
        if (args) {
          const indented = args
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n");
          sections.push(indented);
        }
      }
      sections.push("");
    }
  };

  if (planLog && planLog.turns.length > 0) renderPhase("Planning Phase", planLog);
  if (execLog && execLog.turns.length > 0) renderPhase("Execution Phase", execLog);

  const body = sections.join("\n");

  return `---
${fmLines.join("\n")}
---
# Tool Log: ${planTitle}

${body}
`;
}

// ---- Transcript ----

export function findTranscriptPath(sessionId: string, cwd?: string): string | null {
  const projectsDir = join(homedir(), ".claude", "projects");

  // Try cwd-derived project slug first
  if (cwd) {
    const slug = `-${cwd.replace(/\//g, "-")}`;
    const p = join(projectsDir, slug, `${sessionId}.jsonl`);
    try {
      if (Bun.file(p).size > 0) return p;
    } catch {
      /* */
    }
  }

  // Fallback: scan all project directories
  try {
    for (const dir of readdirSync(projectsDir)) {
      const p = join(projectsDir, dir, `${sessionId}.jsonl`);
      try {
        if (Bun.file(p).size > 0) return p;
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }

  return null;
}
