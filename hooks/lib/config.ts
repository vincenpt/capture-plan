// config.ts — Config loading, context hints, version detection, transcript discovery

import { readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, type ContextHintResult, PLUGIN_ROOT } from "./types.ts";

const PLUGIN_DEFAULT_CONFIG = join(PLUGIN_ROOT, "capture-plan.toml");
const USER_GLOBAL_CONFIG = join(homedir(), ".config", "capture-plan", "config.toml");

const DEFAULT_CONFIG: Config = {
  plan_path: "Claude/Plans",
  journal_path: "Journal",
};

async function loadToml(path: string): Promise<Record<string, unknown> | null> {
  try {
    const loaded = await import(path);
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

/** Load plugin configuration by merging the 3-layer TOML cascade (plugin default, user global, project local). */
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
    superpowers_spec_pattern: (merged.superpowers_spec_pattern as string) || undefined,
    superpowers_plan_pattern: (merged.superpowers_plan_pattern as string) || undefined,
  };
}

/** Summarize content using Claude Haiku, returning a short summary and comma-separated tags. Falls back to text extraction on failure. */
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

const DEFAULT_CONTEXT_CAP = 200_000;

/** Read the context hint file written by SessionStart, returning context cap and CC version. */
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

/** Read the Claude Code version string from the session's context hint file. */
export function readCcVersion(sessionId: string): string | undefined {
  return readContextHint(sessionId).cc_version;
}

/** Parse Claude Code version from `claude --version` output (e.g. "2.1.89 (Claude Code)"). */
export function parseCcVersion(raw: string): string | undefined {
  const match = raw.trim().match(/^(\d+\.\d+\.\d+)/);
  return match ? `v${match[1]}` : undefined;
}

/** Detect the installed Claude Code version by running `claude --version`. */
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

/** Resolve the context window cap from config, session hint, or peak usage heuristic. */
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

/** Return the next plan counter for a date directory by scanning existing `NNN-slug` entries. */
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

/** Locate the JSONL transcript file for a session, trying the cwd-derived project slug first then scanning all projects. */
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
