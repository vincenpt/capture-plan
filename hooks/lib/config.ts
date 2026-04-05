// config.ts — Config loading, context hints, version detection, transcript discovery

import { readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DATE_SCHEMES, type DateScheme } from "./dates.ts";
import { filterNoiseTags } from "./text.ts";
import { type Config, type ContextHintResult, PLUGIN_ROOT } from "./types.ts";

const PLUGIN_DEFAULT_CONFIG = join(PLUGIN_ROOT, "capture-plan.toml");
const USER_GLOBAL_CONFIG = join(homedir(), ".config", "capture-plan", "config.toml");

const DEFAULT_PLAN_PATH = "Claude/Plans";
const DEFAULT_JOURNAL_PATH = "Journal";
const DEFAULT_DATE_SCHEME: DateScheme = "calendar";

/** Default plugin configuration for reference and testing. */
export const DEFAULT_CONFIG: Config = {
  plan: { path: DEFAULT_PLAN_PATH, date_scheme: DEFAULT_DATE_SCHEME },
  journal: { path: DEFAULT_JOURNAL_PATH, date_scheme: DEFAULT_DATE_SCHEME },
};

async function loadToml(path: string): Promise<Record<string, unknown> | null> {
  try {
    const loaded = await import(path);
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

/** Validate and return a DateScheme, falling back to the default if invalid. */
function resolveScheme(raw: unknown): DateScheme {
  if (typeof raw === "string" && (DATE_SCHEMES as readonly string[]).includes(raw)) {
    return raw as DateScheme;
  }
  return DEFAULT_DATE_SCHEME;
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
  const rawCaptureSkills = merged.capture_skills;
  const captureSkills = Array.isArray(rawCaptureSkills)
    ? rawCaptureSkills.filter((s): s is string => typeof s === "string")
    : undefined;

  // Resolve plan config: grouped [plan] table takes precedence over flat plan_path key
  const mergedPlan = merged.plan as Record<string, unknown> | undefined;
  const planPath =
    (mergedPlan?.path as string) || (merged.plan_path as string) || DEFAULT_PLAN_PATH;
  const planScheme = resolveScheme(mergedPlan?.date_scheme);

  // Resolve journal config: grouped [journal] table takes precedence over flat journal_path key
  const mergedJournal = merged.journal as Record<string, unknown> | undefined;
  const journalPath =
    (mergedJournal?.path as string) || (merged.journal_path as string) || DEFAULT_JOURNAL_PATH;
  const journalScheme = resolveScheme(mergedJournal?.date_scheme);

  return {
    vault: (merged.vault as string) || undefined,
    plan: { path: planPath, date_scheme: planScheme },
    journal: { path: journalPath, date_scheme: journalScheme },
    context_cap: contextCap,
    superpowers_spec_pattern: (merged.superpowers_spec_pattern as string) || undefined,
    superpowers_plan_pattern: (merged.superpowers_plan_pattern as string) || undefined,
    capture_skills: captureSkills,
  };
}

const SUMMARIZE_TIMEOUT_MS = 30_000;

/** Summarize content using Claude Haiku, returning a short summary and comma-separated tags. Falls back to text extraction on failure or timeout. */
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
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error("summarize timed out"));
      }, SUMMARIZE_TIMEOUT_MS);
    });
    const result = await Promise.race([
      (async () => {
        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        return { output, exitCode };
      })(),
      timeout,
    ]);
    if (result.exitCode === 0 && !result.output.toLowerCase().includes("not logged in")) {
      const lines = result.output.trim().split("\n").filter(Boolean);
      if (lines.length >= 1) summary = lines[0].trim();
      if (lines.length >= 2) tags = filterNoiseTags(lines[lines.length - 1].trim());
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
  if (!tags) tags = "";
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
