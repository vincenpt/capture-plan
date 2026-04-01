// types.ts — Shared type definitions and path constants

import { dirname } from "node:path";
import type { TranscriptStats } from "../transcript.ts";

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

export interface ContextHintResult {
  context_cap?: number;
  cc_version?: string;
}

export interface AgentFileEntry {
  path: string; // Obsidian vault path (no .md extension)
  content: string; // raw prompt markdown
}

export interface ToolsLogResult {
  markdown: string;
  agentFiles: AgentFileEntry[];
}

// ---- Paths ----

export const HOOKS_DIR = dirname(Bun.main);
export const PLUGIN_ROOT = dirname(HOOKS_DIR);
