// transcript.ts — Transcript parsing utilities for capture-done hook

import { readFileSync } from "node:fs";

// ---- Types ----

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  [key: string]: unknown;
}

// ---- Constants ----

export const EXECUTION_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit", "MultiEdit"]);

// ---- Functions ----

export function getContentBlocks(entry: TranscriptEntry): ContentBlock[] {
  if (entry.type !== "assistant") return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content;
}

export function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  const raw = readFileSync(transcriptPath, "utf8");
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return entries;
}

export function findExitPlanIndex(entries: TranscriptEntry[]): number {
  // Find the LAST ExitPlanMode tool_use (in case of multiple plans)
  let lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "tool_use" && block.name === "ExitPlanMode") {
        lastIdx = i;
      }
    }
  }
  return lastIdx;
}

export function hasExecutionAfter(entries: TranscriptEntry[], afterIdx: number): boolean {
  for (let i = afterIdx + 1; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "tool_use" && block.name && EXECUTION_TOOLS.has(block.name)) {
        return true;
      }
    }
  }
  return false;
}

export function extractLastAssistantText(entries: TranscriptEntry[], afterIdx: number): string {
  // Walk backwards from end, find last assistant text block
  for (let i = entries.length - 1; i > afterIdx; i--) {
    const blocks = getContentBlocks(entries[i]);
    // Collect all text blocks from this assistant message
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) return texts.join("\n\n");
  }
  return "";
}
