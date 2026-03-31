#!/usr/bin/env bun
// capture-done.ts — Claude Code Stop Hook
// Captures the "Done" summary after plan execution completes

import { join } from "node:path";
import {
  appendRowToJournalSection,
  appendToJournal,
  debugLog,
  deleteSessionState,
  findTranscriptPath,
  formatDuration,
  formatStatsInserts,
  formatTagsYaml,
  getDateParts,
  getJournalPath,
  getProjectName,
  getVaultPath,
  loadConfig,
  mergeTags,
  mergeTagsOnDailyNote,
  readSessionState,
  runObsidian,
  summarizeWithClaude,
} from "./shared.ts";
import {
  collectExecutionStats,
  collectTranscriptStats,
  findExitPlanIndex,
  hasExecutionAfter,
  parseTranscript,
  type TranscriptStats,
} from "./transcript.ts";

const DEBUG_LOG = "/tmp/capture-done-debug.log";
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MIN_DONE_LENGTH = 50;

const DONE_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given context about a completed coding session (plan title, duration, files changed, and execution narrative), output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Include concrete outcomes: what was built, changed, or fixed. Mention file count and duration if notable.
Line 2: 1-2 lowercase kebab-case tags (comma-separated, no # prefix).
Output ONLY these two lines.`;

interface StopPayload {
  session_id: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  console.error("[capture-done] hook invoked");
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

    // Collect execution stats from transcript
    const stats = collectExecutionStats(entries, exitIdx);

    // Collect detailed transcript stats for the execution phase
    let transcriptStats: TranscriptStats | null = null;
    try {
      transcriptStats = collectTranscriptStats(entries, exitIdx);
      debugLog(
        `Execution stats: ${transcriptStats.totalToolCalls} tool calls, model=${transcriptStats.model}\n`,
        DEBUG_LOG,
      );
    } catch (err) {
      debugLog(`Failed to collect transcript stats: ${err}\n`, DEBUG_LOG);
    }

    // Use payload's last_assistant_message as fallback when transcript text is short
    const payloadMessage = payload.last_assistant_message ?? "";
    const narrativeText =
      stats.allAssistantText.length >= MIN_DONE_LENGTH
        ? stats.allAssistantText
        : payloadMessage.length >= MIN_DONE_LENGTH
          ? payloadMessage
          : stats.allAssistantText || payloadMessage;

    if (narrativeText.length < MIN_DONE_LENGTH) {
      debugLog(
        `Done text too short (transcript=${stats.allAssistantText.length}, payload=${payloadMessage.length} chars), keeping state for retry\n`,
        DEBUG_LOG,
      );
      process.exit(0); // Keep state — next Stop event can retry
    }

    debugLog(
      `Done text extracted (transcript=${stats.allAssistantText.length}, payload=${payloadMessage.length} chars, using ${stats.allAssistantText.length >= MIN_DONE_LENGTH ? "transcript" : "payload"})\n`,
      DEBUG_LOG,
    );

    // Calculate execution duration
    const durationMs = Date.now() - new Date(state.timestamp).getTime();
    const duration = formatDuration(durationMs);

    // Build richer context for Haiku summarization
    const MAX_HAIKU_INPUT = 8000;
    const haikuParts = [
      `Plan: ${state.plan_title}`,
      `Duration: ${duration}`,
      `Files changed (${stats.filesChanged.length}):`,
      ...stats.filesChanged.map((f) => `  - ${f}`),
      "",
      "Execution narrative:",
      narrativeText,
    ];
    let haikuInput = haikuParts.join("\n");
    if (haikuInput.length > MAX_HAIKU_INPUT) {
      haikuInput = haikuInput.slice(-MAX_HAIKU_INPUT);
    }

    // Summarize with Haiku
    const { summary, tags: newTags } = await summarizeWithClaude(haikuInput, DONE_SYSTEM_PROMPT);

    // Build the summary note
    const config = await loadConfig(payload.cwd);
    const { datetime, ampmTime } = getDateParts();
    const journalPath = getJournalPath(config);

    const summaryPath = `${state.plan_dir}/summary`;

    const project = state.project || getProjectName(payload.cwd);
    const planTags = state.tags
      ? state.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const combinedTagsCsv = mergeTags(planTags, newTags);
    const tagsYaml = formatTagsYaml(combinedTagsCsv);

    const fileList =
      stats.filesChanged.length > 0
        ? stats.filesChanged.map((f) => `- \`${f}\``).join("\n")
        : "_No file changes recorded_";

    const { statsYaml, addendumSection } = formatStatsInserts(transcriptStats);

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
plan: "[[${state.plan_dir}/plan|${state.plan_title}]]"
duration: "${duration}"
summary: "${summary.replace(/"/g, '\\"')}"${statsYaml}
---
# Done: ${state.plan_title}

## Summary

${summary}

*Completed in ${duration} — ${stats.filesChanged.length} files changed*

## Files Changed

${fileList}${addendumSection}
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
      appended = await appendRowToJournalSection(state.plan_title, tableRow, fullJournalPath);
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[capture-done] Fatal error: ${msg}`);
    debugLog(`Fatal error: ${err}\n`, DEBUG_LOG);
  }

  process.exit(0);
}

main();
