// types.ts — Shared type definitions and path constants

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { TranscriptStats } from "../transcript.ts"
import type { DateScheme } from "./dates.ts"

/** Configuration for a single path section (plan or journal). */
export interface PathConfig {
  path: string
  date_scheme: DateScheme
}

/** Configuration for session document capture. */
export interface SessionConfig {
  path: string
  prompt_max_chars?: number
  enabled?: boolean
}

/** Plugin configuration loaded from the 3-layer TOML config cascade. */
export interface Config {
  vault?: string
  plan: PathConfig
  journal: PathConfig
  session: SessionConfig
  context_cap?: number
  superpowers_spec_pattern?: string
  superpowers_plan_pattern?: string
  capture_skills?: string[]
}

/** Persisted state that bridges the ExitPlanMode and Stop hooks within a session. */
export interface SessionState {
  session_id: string
  plan_slug: string
  plan_title: string
  plan_dir: string
  date_key: string
  timestamp: string
  journal_path?: string
  project?: string
  tags?: string
  model?: string
  cc_version?: string
  planStats?: TranscriptStats
  source?: "plan-mode" | "superpowers" | "skill"
  spec_path?: string
  skill_name?: string
  completed?: boolean
}

/** Parsed YAML frontmatter fields from a plan note. */
export interface PlanFrontmatter {
  created?: string
  journalPath?: string
  datetime?: string
  status?: string
  tags?: string[]
  counter?: number
  session?: string
  project?: string
  source_slug?: string
}

/** Context window and version info read from the SessionStart hint file. */
export interface ContextHintResult {
  context_cap?: number
  cc_version?: string
}

/** A subagent prompt to be written as a separate note in the vault. */
export interface AgentFileEntry {
  path: string // Obsidian vault path (no .md extension)
  content: string // raw prompt markdown
}

/** Rendered tool-log markdown together with any extracted agent prompt files. */
export interface ToolsLogResult {
  markdown: string
  agentFiles: AgentFileEntry[]
}

/** Absolute path to the hooks/ directory (derived from the running script). */
export const HOOKS_DIR = dirname(Bun.main)
/** Absolute path to the plugin root directory. Prefers CLAUDE_PLUGIN_ROOT env var (set by CC for plugin hooks) over Bun.main derivation to avoid symlink resolution issues. */
export const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || dirname(HOOKS_DIR)
/** True when the plugin is running from a symlinked dev repo (has .git dir). */
export const IS_DEV_MODE: boolean = existsSync(join(PLUGIN_ROOT, ".git"))
