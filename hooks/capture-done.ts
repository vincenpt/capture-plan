#!/usr/bin/env bun
// capture-done.ts — Claude Code Stop Hook
// Captures the "Done" summary after plan execution completes

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  debugLog,
  loadConfig,
  runObsidian,
  summarizeWithClaude,
  mergeTagsOnDailyNote,
  getDateParts,
  getJournalPath,
  appendToJournal,
  appendRowToJournalSection,
  getVaultPath,
  readSessionState,
  deleteSessionState,
  findTranscriptPath,
} from "./shared.ts";

const DEBUG_LOG = "/tmp/capture-done-debug.log";
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MIN_DONE_LENGTH = 50;

const DONE_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given an execution summary from a coding session, output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Focus on what was built, changed, or fixed.
Line 2: 1-2 lowercase kebab-case tags (comma-separated, no # prefix).
Output ONLY these two lines.`;

interface StopPayload {
  session_id: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  [key: string]: unknown;
}

const EXECUTION_TOOLS = new Set([
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "MultiEdit",
]);

function getContentBlocks(entry: TranscriptEntry): ContentBlock[] {
  if (entry.type !== "assistant") return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content;
}

function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  const raw = readFileSync(transcriptPath, "utf8");
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
  return entries;
}

function findExitPlanIndex(entries: TranscriptEntry[]): number {
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

function hasExecutionAfter(entries: TranscriptEntry[], afterIdx: number): boolean {
  for (let i = afterIdx + 1; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "tool_use" && EXECUTION_TOOLS.has(block.name!)) {
        return true;
      }
    }
  }
  return false;
}

function extractLastAssistantText(
  entries: TranscriptEntry[],
  afterIdx: number,
): string {
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

async function main(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    debugLog(`=== STOP ${new Date().toISOString()} ===\n${input}\n---\n`, DEBUG_LOG);

    const payload: StopPayload = JSON.parse(input);
    const sessionId = payload.session_id;
    if (!sessionId) {
      debugLog("No session_id in payload\n", DEBUG_LOG);
      process.exit(0);
    }

    // Gate: check for pending session state
    const state = await readSessionState(sessionId);
    if (!state) {
      // Most common case — no plan pending for this session
      process.exit(0);
    }

    debugLog(`Found state for session ${sessionId}: ${state.plan_title}\n`, DEBUG_LOG);

    // Check staleness
    const stateAge = Date.now() - new Date(state.timestamp).getTime();
    if (stateAge > STALE_MS) {
      debugLog(`State stale (${Math.round(stateAge / 60000)}m), cleaning up\n`, DEBUG_LOG);
      deleteSessionState(sessionId);
      process.exit(0);
    }

    // Find transcript
    let transcriptPath = payload.transcript_path || null;
    if (!transcriptPath) {
      transcriptPath = findTranscriptPath(sessionId, payload.cwd);
    }
    if (!transcriptPath) {
      debugLog("Cannot find transcript, keeping state for retry\n", DEBUG_LOG);
      process.exit(0);
    }

    debugLog(`Transcript: ${transcriptPath}\n`, DEBUG_LOG);

    // Parse transcript
    const entries = parseTranscript(transcriptPath);
    const exitIdx = findExitPlanIndex(entries);
    if (exitIdx === -1) {
      debugLog("No ExitPlanMode in transcript\n", DEBUG_LOG);
      deleteSessionState(sessionId);
      process.exit(0);
    }

    // Check for execution activity after ExitPlanMode
    if (!hasExecutionAfter(entries, exitIdx)) {
      debugLog("No execution tools after ExitPlanMode, waiting for next Stop\n", DEBUG_LOG);
      process.exit(0); // Keep state — plan not yet executed
    }

    // Extract the Done summary (last assistant text after execution)
    const doneText = extractLastAssistantText(entries, exitIdx);
    if (doneText.length < MIN_DONE_LENGTH) {
      debugLog(`Done text too short (${doneText.length} chars), cleaning up\n`, DEBUG_LOG);
      deleteSessionState(sessionId);
      process.exit(0);
    }

    debugLog(`Done text extracted (${doneText.length} chars)\n`, DEBUG_LOG);

    // Summarize with Haiku
    const { summary, tags: newTags } = await summarizeWithClaude(
      doneText,
      DONE_SYSTEM_PROMPT,
    );

    // Build the summary note
    const config = await loadConfig(payload.cwd);
    const { dd, mm, yyyy, datetime, timeStr, ampmTime } = getDateParts();
    const journalPath = getJournalPath(config);

    const summaryPath = `${state.plan_dir}/summary`;

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"
status: done
tags:
  - done-summary
  - claude-session
source: Claude Code (Execution)
session: ${state.session_id}
plan: "[[${state.plan_dir}/plan|${state.plan_title}]]"
summary: "${summary.replace(/"/g, '\\"')}"
counter: ${state.counter}
---

# Done: ${state.plan_title}

## Summary

${summary}

## Execution Report

${doneText}
`;

    const escapedContent = noteContent.replace(/\n/g, "\\n");
    const createResult = runObsidian(
      ["create", `path=${summaryPath}`, `content=${escapedContent}`, "silent"],
      config.vault,
    );
    if (createResult.exitCode !== 0) {
      debugLog("Failed to create summary note\n", DEBUG_LOG);
      deleteSessionState(sessionId);
      process.exit(0);
    }

    // Append row to existing plan section in journal
    const tableRow = `| [[${summaryPath}\\|${ampmTime}]] | ${summary} |`;
    let appended = false;
    const journalToModify = state.journal_path || journalPath;
    const vaultPath = getVaultPath(config.vault);

    if (vaultPath) {
      const journalFile = journalToModify.endsWith(".md")
        ? journalToModify
        : `${journalToModify}.md`;
      const fullJournalPath = join(vaultPath, journalFile);
      appended = await appendRowToJournalSection(
        state.plan_title,
        tableRow,
        fullJournalPath,
      );
      debugLog(`appendRowToJournalSection: ${appended}\n`, DEBUG_LOG);
    }

    if (!appended) {
      // Fallback: create a new section (different day, missing file, etc.)
      const fallbackEntry = `\\n### ${state.plan_title}\\n\\n| | |\\n|---|---|\\n| [[${summaryPath}\\|${ampmTime}]] | ${summary} |`;
      appendToJournal(fallbackEntry, journalPath, config.vault);
    }

    mergeTagsOnDailyNote(newTags, journalPath, config.vault);

    // Clean up session state
    deleteSessionState(sessionId);

    console.error(`Done summary captured -> ${summaryPath}.md`);
    debugLog(`Summary captured for ${state.plan_title}\n`, DEBUG_LOG);
  } catch (err) {
    debugLog(`Fatal error: ${err}\n`, DEBUG_LOG);
  }

  process.exit(0);
}

main();
