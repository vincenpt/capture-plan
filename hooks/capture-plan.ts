#!/usr/bin/env bun
// capture-plan.ts — Claude Code Hook for ExitPlanMode
// Captures plans and persists them to Obsidian vault

import {
  debugLog,
  loadConfig,
  runObsidian,
  extractTitle,
  stripTitleLine,
  toSlug,
  summarizeWithClaude,
  mergeTagsOnDailyNote,
  getDateParts,
  getJournalPath,
  appendToJournal,
  nextCounter,
  padCounter,
  writeSessionState,
  type SessionState,
} from "./shared.ts";

const DEBUG_LOG = "/tmp/capture-plan-debug.log";

const PLAN_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given an engineering plan, output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.
Line 2: 1-2 lowercase kebab-case tags relevant to the plan topic (comma-separated, no # prefix).
Output ONLY these two lines.`;

interface HookPayload {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  cwd?: string;
  tool_input: {
    plan?: string;
    planFilePath?: string;
    [key: string]: unknown;
  };
  tool_response?:
    | { plan?: string; filePath?: string; [key: string]: unknown }
    | string;
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
    const content = await Bun.file(resp.filePath).text().catch(() => "");
    if (content) return { content, source: "tool_response.filePath", file: resp.filePath };
  }
  if (payload.tool_input?.plan && payload.tool_input.plan !== "null") {
    return { content: payload.tool_input.plan, source: "tool_input.plan", file: "" };
  }
  const planFilePath = payload.tool_input?.planFilePath;
  if (planFilePath && planFilePath !== "null") {
    const content = await Bun.file(planFilePath).text().catch(() => "");
    if (content) return { content, source: "tool_input.planFilePath", file: planFilePath };
  }
  return null;
}

async function main(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    debugLog(`=== ${new Date().toISOString()} ===\n${input}\n---\n`, DEBUG_LOG);

    const payload: HookPayload = JSON.parse(input);
    if (payload.tool_name !== "ExitPlanMode") process.exit(0);

    const hookEvent = payload.hook_event_name || "";
    const sessionId = payload.session_id || "unknown";

    const extraction = await extractPlanContent(payload);
    if (!extraction || extraction.content.length < 20) {
      debugLog(`No valid plan content\n`, DEBUG_LOG);
      process.exit(0);
    }

    const { content: planContent, source: planSource, file: planFile } = extraction;
    const title = extractTitle(planContent);
    const slug = toSlug(title);
    const { dd, mm, yyyy, dateKey, datetime, timeStr, ampmTime } = getDateParts();

    debugLog(
      `HOOK=${hookEvent} SRC=${planSource} FILE=${planFile} TITLE=${title} SLUG=${slug}\n`,
      DEBUG_LOG,
    );

    const config = await loadConfig(payload.cwd);
    const counter = await nextCounter(dateKey);
    const { summary, tags: newTags } = await summarizeWithClaude(planContent, PLAN_SYSTEM_PROMPT);

    // New path: Claude/Plans/<yyyy>/<mm-dd>/<counter>-<slug>/plan
    const planDir = `${config.plan_path}/${yyyy}/${mm}-${dd}/${padCounter(counter)}-${slug}`;
    const planPath = `${planDir}/plan`;

    const journalPath = getJournalPath(config);

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"
status: planned
tags:
  - plan
  - claude-session
source: Claude Code (Plan Mode)
session: ${sessionId}
counter: ${counter}
---

# ${title}

${stripTitleLine(planContent)}
`;

    const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${planPath}\\|${ampmTime}]] | ${summary} |`;
    const escapedContent = noteContent.replace(/\n/g, "\\n");
    const createResult = runObsidian(
      ["create", `path=${planPath}`, `content=${escapedContent}`, "silent"],
      config.vault,
    );
    if (createResult.exitCode !== 0) {
      debugLog("Failed to create plan note\n", DEBUG_LOG);
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
      counter,
      date_key: dateKey,
      timestamp: new Date().toISOString(),
      journal_path: journalPath,
    };
    await writeSessionState(sessionId, state);

    console.log(`Plan captured -> ${planPath}.md`);
    debugLog(`State written for session ${sessionId}\n`, DEBUG_LOG);
  } catch (err) {
    debugLog(`Fatal error: ${err}\n`, DEBUG_LOG);
  }

  process.exit(0);
}

main();
