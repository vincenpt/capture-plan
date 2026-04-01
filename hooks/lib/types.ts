// types.ts — Shared type definitions and path constants

import { dirname } from "node:path";
import type { TranscriptStats } from "../transcript.ts";

/** Plugin configuration loaded from the 3-layer TOML config cascade. */
export interface Config {
  vault?: string;
  plan_path: string;
  journal_path: string;
  context_cap?: number;
}

/** Persisted state that bridges the ExitPlanMode and Stop hooks within a session. */
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

/** Parsed YAML frontmatter fields from a plan note. */
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

/** Context window and version info read from the SessionStart hint file. */
export interface ContextHintResult {
  context_cap?: number;
  cc_version?: string;
}

/** A subagent prompt to be written as a separate note in the vault. */
export interface AgentFileEntry {
  path: string; // Obsidian vault path (no .md extension)
  content: string; // raw prompt markdown
}

/** Rendered tool-log markdown together with any extracted agent prompt files. */
export interface ToolsLogResult {
  markdown: string;
  agentFiles: AgentFileEntry[];
}

/** Absolute path to the hooks/ directory (derived from the running script). */
export const HOOKS_DIR = dirname(Bun.main);
/** Absolute path to the plugin root directory (parent of hooks/). */
export const PLUGIN_ROOT = dirname(HOOKS_DIR);
