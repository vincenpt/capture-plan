#!/usr/bin/env bun
// capture-plan.ts — Claude Code Hook for ExitPlanMode
// Captures plans and persists them to Obsidian vault

import { join } from "node:path";
import { PLAN_SYSTEM_PROMPT } from "./lib/prompts.ts";
import {
  appendToJournal,
  createVaultNote,
  debugLog,
  detectCcVersion,
  extractTitle,
  findTranscriptPath,
  formatCcVersionYaml,
  formatModelYaml,
  formatTagsYaml,
  getDateParts,
  getJournalPath,
  getPlanDatePath,
  getProjectName,
  getVaultPath,
  loadConfig,
  mergeTagsOnDailyNote,
  nextCounter,
  padCounter,
  readCcVersion,
  resolveContextCap,
  type SessionState,
  shortSessionId,
  stripTitleLine,
  summarizeWithClaude,
  toSlug,
  writeVaultState,
} from "./shared.ts";
import {
  collectTranscriptStats,
  extractPlanText,
  findExitPlanIndex,
  parseTranscript,
  type TranscriptEntry,
  type TranscriptStats,
} from "./transcript.ts";

const DEBUG_LOG = "/tmp/capture-plan-debug.log";

interface HookPayload {
  session_id: string;
  transcript_path?: string;
  hook_event_name: string;
  tool_name: string;
  cwd?: string;
  tool_input: {
    plan?: string;
    planFilePath?: string;
    [key: string]: unknown;
  };
  tool_response?: { plan?: string; filePath?: string; [key: string]: unknown } | string;
}

async function extractPlanContent(
  payload: HookPayload,
): Promise<{ content: string; source: string; file: string } | null> {
  const resp =
    typeof payload.tool_response === "object" && payload.tool_response !== null
      ? payload.tool_response
      : {};

  if (resp.plan && resp.plan !== "null") {
    return { content: resp.plan, source: "tool_response.plan", file: "" };
  }
  if (resp.filePath && resp.filePath !== "null") {
    const content = await Bun.file(resp.filePath)
      .text()
      .catch(() => "");
    if (content) return { content, source: "tool_response.filePath", file: resp.filePath };
  }
  if (payload.tool_input?.plan && payload.tool_input.plan !== "null") {
    return { content: payload.tool_input.plan, source: "tool_input.plan", file: "" };
  }
  const planFilePath = payload.tool_input?.planFilePath;
  if (planFilePath && planFilePath !== "null") {
    const content = await Bun.file(planFilePath)
      .text()
      .catch(() => "");
    if (content) return { content, source: "tool_input.planFilePath", file: planFilePath };
  }
  return null;
}

async function main(): Promise<void> {
  console.error("[capture-plan] hook invoked");
  try {
    const input = await Bun.stdin.text();
    debugLog(`=== ${new Date().toISOString()} ===\n${input}\n---\n`, DEBUG_LOG);

    const payload: HookPayload = JSON.parse(input);
    if (payload.tool_name !== "ExitPlanMode") process.exit(0);

    const hookEvent = payload.hook_event_name || "";
    const sessionId = payload.session_id || "unknown";

    let extraction = await extractPlanContent(payload);

    // Transcript fallback: parse once, reuse for both plan extraction and stats
    let entries: TranscriptEntry[] | null = null;
    let exitIdx = -1;
    const transcriptPath = payload.transcript_path || findTranscriptPath(sessionId, payload.cwd);

    if ((!extraction || extraction.content.length < 20) && transcriptPath) {
      try {
        entries = parseTranscript(transcriptPath);
        exitIdx = findExitPlanIndex(entries);
        if (exitIdx >= 0) {
          const planText = extractPlanText(entries, exitIdx);
          if (planText.length >= 20) {
            extraction = { content: planText, source: "transcript", file: "" };
            debugLog(`Plan extracted from transcript (${planText.length} chars)\n`, DEBUG_LOG);
          }
        }
      } catch (err) {
        debugLog(`Transcript fallback failed: ${err}\n`, DEBUG_LOG);
      }
    }

    if (!extraction || extraction.content.length < 20) {
      debugLog("No valid plan content\n", DEBUG_LOG);
      process.exit(0);
    }

    const { content: planContent, source: planSource, file: planFile } = extraction;
    const title = extractTitle(planContent);
    const slug = toSlug(title);
    const dateParts = getDateParts();
    const { dateKey, datetime, ampmTime } = dateParts;

    const config = await loadConfig(payload.cwd);
    const dateDirRelative = getPlanDatePath(config, dateParts);

    debugLog(
      `HOOK=${hookEvent} SRC=${planSource} FILE=${planFile} TITLE=${title} SLUG=${slug} DATE_DIR=${dateDirRelative}\n`,
      DEBUG_LOG,
    );

    // Collect planning-phase stats from transcript (reuse parsed entries if available)
    let stats: TranscriptStats | null = null;
    try {
      if (!entries && transcriptPath) {
        entries = parseTranscript(transcriptPath);
        exitIdx = findExitPlanIndex(entries);
      }
      if (entries && exitIdx >= 0) {
        stats = collectTranscriptStats(entries, 0, exitIdx);
        debugLog(
          `Transcript stats collected: ${stats.totalToolCalls} tool calls, model=${stats.model}\n`,
          DEBUG_LOG,
        );
      }
    } catch (err) {
      debugLog(`Failed to collect transcript stats: ${err}\n`, DEBUG_LOG);
    }

    const vaultPath = getVaultPath(config.vault);

    // Detect scheme mismatch — warn if vault has dirs in a different layout
    if (vaultPath) {
      try {
        const { detectVaultSchemes } = await import("./lib/migration.ts");
        const onDisk = detectVaultSchemes(join(vaultPath, config.plan.path));
        for (const detected of onDisk) {
          if (detected !== config.plan.date_scheme) {
            debugLog(
              `Layout mismatch: vault has '${detected}' dirs but config uses '${config.plan.date_scheme}'. Run /capture-plan:migrate-layout to migrate.\n`,
              DEBUG_LOG,
            );
            break;
          }
        }
      } catch {
        /* detection is advisory, never block */
      }
    }

    const dateDirAbsolute = vaultPath ? join(vaultPath, dateDirRelative) : null;
    const counter = dateDirAbsolute ? nextCounter(dateDirAbsolute) : 1;
    const { summary, tags: newTags } = await summarizeWithClaude(planContent, PLAN_SYSTEM_PROMPT);

    const planDir = `${dateDirRelative}/${padCounter(counter)}-${slug}`;
    const planPath = `${planDir}/plan`;

    const journalPath = getJournalPath(config);

    const project = getProjectName(payload.cwd);
    const tagsYaml = formatTagsYaml(newTags);

    const contextCap = resolveContextCap(
      stats?.peakTurnContext ?? 0,
      config.context_cap,
      sessionId,
    );
    const modelYaml = formatModelYaml(stats, contextCap);
    const ccVersion = detectCcVersion() ?? readCcVersion(sessionId);
    const ccVersionYaml = formatCcVersionYaml(ccVersion);

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
session: "[[Sessions/${shortSessionId(sessionId)}]]"${ccVersionYaml}${modelYaml}
---
# ${title}

${stripTitleLine(planContent)}
`;

    const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${planPath}\\|${ampmTime}]] | ${summary} |`;
    const createResult = createVaultNote(planPath, noteContent, config.vault);
    if (!createResult.success) {
      debugLog(
        `Failed to create plan note: stdout=${createResult.stdout} stderr=${createResult.stderr}\n`,
        DEBUG_LOG,
      );
      process.exit(0);
    }

    appendToJournal(journalEntry, journalPath, config.vault);
    mergeTagsOnDailyNote(newTags, journalPath, config.vault);

    // Write session state for the Stop hook to pick up
    const state: SessionState = {
      session_id: sessionId,
      plan_slug: slug,
      plan_title: title,
      plan_dir: planDir,
      date_key: dateKey,
      timestamp: new Date().toISOString(),
      journal_path: journalPath,
      project,
      tags: newTags,
      model: stats?.model,
      cc_version: ccVersion,
      planStats: stats ?? undefined,
      source: "plan-mode",
    };
    const stateWritten = writeVaultState(state, config.vault);
    if (!stateWritten) {
      debugLog("Failed to write vault state\n", DEBUG_LOG);
    }

    console.log(`Plan captured -> ${planPath}.md`);
    debugLog(`State written for session ${sessionId}\n`, DEBUG_LOG);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[capture-plan] Fatal error: ${msg}`);
    debugLog(`Fatal error: ${err}\n`, DEBUG_LOG);
  }

  process.exit(0);
}

main();
