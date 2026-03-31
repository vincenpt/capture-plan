#!/usr/bin/env bun
// capture-done.ts — Claude Code Stop Hook
// Captures the "Done" summary after plan execution completes

import { basename, join } from "node:path";
import {
  appendRowToJournalSection,
  appendToJournal,
  debugLog,
  deleteVaultState,
  findTranscriptPath,
  formatDuration,
  formatModelYaml,
  formatTagsYaml,
  formatToolsNoteContent,
  getDateParts,
  getJournalPath,
  getProjectName,
  getVaultPath,
  loadConfig,
  mergeTags,
  mergeTagsOnDailyNote,
  runObsidian,
  scanForVaultState,
  summarizeWithClaude,
} from "./shared.ts";
import {
  collectExecutionStats,
  collectTranscriptStats,
  computeDurationMs,
  findExitPlanIndex,
  hasExecutionAfter,
  parseTranscript,
  selectDoneText,
  type TranscriptStats,
} from "./transcript.ts";

const DEBUG_LOG = "/tmp/capture-done-debug.log";
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

    // Load config early — needed for vault-based state lookup
    const config = await loadConfig(payload.cwd);

    // Gate: scan vault for pending session state (also cleans up stale states)
    const state = scanForVaultState(sessionId, config);
    if (!state) {
      // Most common case — no plan pending for this session
      process.exit(0);
    }

    debugLog(`Found state for session ${sessionId}: ${state.plan_title}\n`, DEBUG_LOG);

    // Resolve vault filesystem path (used for state cleanup and journal appends)
    const vaultPath = getVaultPath(config.vault);

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
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
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

    // Calculate session duration — prefer transcript timestamps (full session) over wall-clock
    const transcriptDurationMs = computeDurationMs(entries);
    const wallClockMs = Date.now() - new Date(state.timestamp).getTime();
    const durationMs = transcriptDurationMs > 0 ? transcriptDurationMs : wallClockMs;
    const duration = formatDuration(durationMs);

    // Build richer context for Haiku summarization
    // Put narrative first so that if Haiku fails, the fallback extracts from the narrative
    // rather than echoing the structured metadata header
    const MAX_HAIKU_INPUT = 8000;
    const metadata = [
      `Plan: ${state.plan_title}`,
      `Duration: ${duration}`,
      `Files changed (${stats.filesChanged.length}): ${stats.filesChanged.map((f) => basename(f)).join(", ")}`,
    ].join(" | ");
    let haikuInput = `${metadata}\n\n${narrativeText}`;
    if (haikuInput.length > MAX_HAIKU_INPUT) {
      // Truncate from the front of the narrative, keeping the most recent text
      haikuInput = `${metadata}\n\n${narrativeText.slice(-(MAX_HAIKU_INPUT - metadata.length - 2))}`;
    }

    // Summarize with Haiku
    const { summary, tags: newTags } = await summarizeWithClaude(haikuInput, DONE_SYSTEM_PROMPT);

    // Select the richest available text for the Summary section body
    const doneText = selectDoneText(payloadMessage, stats, summary);

    // Build the summary note
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

    const modelYaml = formatModelYaml(transcriptStats);

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
plan: "[[${state.plan_dir}/plan|${state.plan_title.replace(/"/g, '\\"')}]]"
duration: "${duration}"${modelYaml}
---
# Done: ${state.plan_title}

## Summary

${doneText}

## Files Changed

${fileList}

---
*Duration: ${duration}*
`;

    const escapedContent = noteContent.replace(/\n/g, "\\n");
    const createResult = runObsidian(
      ["create", `path=${summaryPath}`, `content=${escapedContent}`, "silent"],
      config.vault,
    );
    if (createResult.exitCode !== 0) {
      debugLog("Failed to create summary note\n", DEBUG_LOG);
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
      process.exit(0);
    }

    // Create plan-tools.md with combined stats from both phases
    const planStats = state.planStats ?? null;
    const toolsNoteContent = formatToolsNoteContent({
      planStats,
      execStats: transcriptStats,
      planTitle: state.plan_title,
      planDir: state.plan_dir,
      journalPath,
      datetime,
      project,
    });

    if (toolsNoteContent) {
      const toolsNotePath = `${state.plan_dir}/plan-tools`;
      const escapedToolsContent = toolsNoteContent.replace(/\n/g, "\\n");
      const toolsResult = runObsidian(
        ["create", `path=${toolsNotePath}`, `content=${escapedToolsContent}`, "silent"],
        config.vault,
      );
      if (toolsResult.exitCode !== 0) {
        debugLog("Failed to create plan-tools note\n", DEBUG_LOG);
      } else {
        debugLog(`Plan tools captured -> ${toolsNotePath}.md\n`, DEBUG_LOG);
      }
    }

    // Append row to existing plan section in journal
    const tableRow = `| [[${summaryPath}\\|${ampmTime}]] | ${summary} |`;
    let appended = false;
    const journalToModify = state.journal_path || journalPath;

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

    // Clean up session state from vault
    if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);

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
