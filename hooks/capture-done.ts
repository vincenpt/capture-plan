#!/usr/bin/env bun
// capture-done.ts — Claude Code Stop Hook
// Captures the "Done" summary after plan execution completes

import { basename, join } from "node:path";
import {
  appendRowToJournalSection,
  appendToJournal,
  type Config,
  createVaultNote,
  debugLog,
  deleteVaultState,
  detectCcVersion,
  extractTitle,
  findTranscriptPath,
  formatCcVersionYaml,
  formatDuration,
  formatModelYaml,
  formatTagsYaml,
  formatToolsLogContent,
  formatToolsNoteContent,
  getDateParts,
  getJournalPath,
  getProjectName,
  getVaultPath,
  loadConfig,
  mergeTags,
  mergeTagsOnDailyNote,
  nextCounter,
  padCounter,
  readCcVersion,
  resolveContextCap,
  type SessionState,
  scanForVaultState,
  shortSessionId,
  stripTitleLine,
  summarizeWithClaude,
  toSlug,
  writeVaultState,
} from "./shared.ts";
import {
  collectExecutionStats,
  collectToolLog,
  collectTranscriptStats,
  computeDurationMs,
  findExitPlanIndex,
  findSkillInvocations,
  findSuperpowersBoundary,
  findSuperpowersWrites,
  hasExecutionAfter,
  parseTranscript,
  type SkillInvocation,
  type SuperpowersWrite,
  selectDoneText,
  type TranscriptEntry,
  type TranscriptStats,
  transcriptContainsPattern,
} from "./transcript.ts";

const DEBUG_LOG = "/tmp/capture-done-debug.log";
const MIN_DONE_LENGTH = 50;

const DONE_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given context about a completed coding session (plan title, duration, files changed, and execution narrative), output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Include concrete outcomes: what was built, changed, or fixed. Mention file count and duration if notable.
Line 2: 1-2 lowercase kebab-case tags (comma-separated, no # prefix).
Output ONLY these two lines.`;

const PLAN_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given an engineering plan or design spec, output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Be specific about what will be built or changed.
Line 2: 1-2 lowercase kebab-case tags relevant to the plan topic (comma-separated, no # prefix).
Output ONLY these two lines.`;

const SKILL_SYSTEM_PROMPT = `You are a concise note-taking assistant. Given context about a coding session where automated skills were used (skill names, context, and outcomes), output exactly two lines:
Line 1: A 1-2 sentence summary (max 200 chars). Include what skills ran and their concrete outcomes.
Line 2: 1-2 lowercase kebab-case tags relevant to the activity (comma-separated, no # prefix).
Output ONLY these two lines.`;

interface StopPayload {
  session_id: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  [key: string]: unknown;
}

/** Build a SessionState on the fly for a superpowers session, creating the plan vault note. */
async function buildSuperpowersState(
  sessionId: string,
  writes: SuperpowersWrite[],
  entries: TranscriptEntry[],
  payload: StopPayload,
  config: Config,
): Promise<{ state: SessionState; boundaryIdx: number } | null> {
  // Pick primary: prefer plan over spec
  const plans = writes.filter((w) => w.type === "plan");
  const primary = plans.length > 0 ? plans[plans.length - 1] : writes[writes.length - 1];
  const specs = writes.filter((w) => w.type === "spec");

  const planContent = primary.content;
  if (!planContent || planContent.length < 20) return null;

  const title = extractTitle(planContent);
  const slug = toSlug(title);
  const { dd, mm, yyyy, dateKey, datetime, ampmTime } = getDateParts();
  const dateDirRelative = `${config.plan_path}/${yyyy}/${mm}-${dd}`;

  const vaultPath = getVaultPath(config.vault);
  const dateDirAbsolute = vaultPath ? join(vaultPath, dateDirRelative) : null;
  const counter = dateDirAbsolute ? nextCounter(dateDirAbsolute) : 1;

  const { summary, tags: newTags } = await summarizeWithClaude(planContent, PLAN_SYSTEM_PROMPT);
  const planDir = `${dateDirRelative}/${padCounter(counter)}-${slug}`;
  const planPath = `${planDir}/plan`;
  const journalPath = getJournalPath(config);
  const project = getProjectName(payload.cwd);
  const tagsYaml = formatTagsYaml(newTags);

  // Collect planning-phase stats
  const boundaryIdx = findSuperpowersBoundary(writes);
  let planStats: TranscriptStats | null = null;
  try {
    if (boundaryIdx >= 0) {
      planStats = collectTranscriptStats(entries, 0, boundaryIdx);
    }
  } catch {
    /* ignore */
  }

  const contextCap = resolveContextCap(
    planStats?.peakTurnContext ?? 0,
    config.context_cap,
    sessionId,
  );
  const modelYaml = formatModelYaml(planStats, contextCap);
  const ccVersion = detectCcVersion() ?? readCcVersion(sessionId);
  const ccVersionYaml = formatCcVersionYaml(ccVersion);

  const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
session: "[[Sessions/${shortSessionId(sessionId)}]]"${ccVersionYaml}${modelYaml}
source: superpowers${primary.filePath ? `\nspec_file: "${primary.filePath}"` : ""}
---
# ${title}

${stripTitleLine(planContent)}
`;

  const createResult = createVaultNote(planPath, noteContent, config.vault);
  if (!createResult.success) {
    debugLog("Failed to create superpowers plan note\n", DEBUG_LOG);
    return null;
  }

  // If there's a separate spec, create it as a sibling note
  if (specs.length > 0 && specs[specs.length - 1] !== primary) {
    const spec = specs[specs.length - 1];
    const specTitle = extractTitle(spec.content);
    const specNoteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}
plan: "[[${planPath}|${title}]]"
source: superpowers
---
# ${specTitle}

${stripTitleLine(spec.content)}
`;
    createVaultNote(`${planDir}/spec`, specNoteContent, config.vault);
  }

  const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${planPath}\\|${ampmTime}]] | ${summary} |`;
  appendToJournal(journalEntry, journalPath, config.vault);
  mergeTagsOnDailyNote(newTags, journalPath, config.vault);

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
    model: planStats?.model,
    cc_version: ccVersion,
    planStats: planStats ?? undefined,
    source: "superpowers",
    spec_path: primary.filePath,
  };

  writeVaultState(state, config.vault);
  debugLog(`Superpowers state built: ${title} -> ${planPath}\n`, DEBUG_LOG);
  return { state, boundaryIdx };
}

/** Build a SessionState on the fly for a skill-only session, creating the activity vault note. */
async function buildSkillState(
  sessionId: string,
  invocations: SkillInvocation[],
  entries: TranscriptEntry[],
  payload: StopPayload,
  config: Config,
): Promise<{ state: SessionState; boundaryIdx: number } | null> {
  if (invocations.length === 0) return null;

  // Build narrative from all skill invocations' surrounding context
  const narrative = invocations
    .map((inv) => {
      const parts = [inv.contextBefore, inv.contextAfter].filter(Boolean);
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (narrative.length < 20) return null;

  // Summarize with Haiku to get title and tags
  const { summary, tags: newTags } = await summarizeWithClaude(narrative, SKILL_SYSTEM_PROMPT);

  // Use Haiku summary as title, truncated to first sentence or 80 chars
  const rawTitle = extractTitle(summary) || `${invocations[0].skill} session`;
  const title = rawTitle.length > 80 ? `${rawTitle.slice(0, 77)}...` : rawTitle;
  const slug = toSlug(title);
  const { dd, mm, yyyy, dateKey, datetime, ampmTime } = getDateParts();
  const dateDirRelative = `${config.plan_path}/${yyyy}/${mm}-${dd}`;

  const vaultPath = getVaultPath(config.vault);
  const dateDirAbsolute = vaultPath ? join(vaultPath, dateDirRelative) : null;
  const counter = dateDirAbsolute ? nextCounter(dateDirAbsolute) : 1;

  const planDir = `${dateDirRelative}/${padCounter(counter)}-${slug}`;
  const activityPath = `${planDir}/activity`;
  const journalPath = getJournalPath(config);
  const project = getProjectName(payload.cwd);
  const tagsYaml = formatTagsYaml(newTags);

  // Use first skill invocation as boundary
  const boundaryIdx = invocations[0].index;

  // Collect planning-phase stats (everything before the first skill)
  let planStats: TranscriptStats | null = null;
  try {
    if (boundaryIdx > 0) {
      planStats = collectTranscriptStats(entries, 0, boundaryIdx);
    }
  } catch {
    /* ignore */
  }

  const contextCap = resolveContextCap(
    planStats?.peakTurnContext ?? 0,
    config.context_cap,
    sessionId,
  );
  const modelYaml = formatModelYaml(planStats, contextCap);
  const ccVersion = detectCcVersion() ?? readCcVersion(sessionId);
  const ccVersionYaml = formatCcVersionYaml(ccVersion);

  // Build skills YAML list
  const skillNames = invocations.map((inv) => inv.skill);
  const uniqueSkills = [...new Set(skillNames)];
  const skillsYaml = uniqueSkills.map((s) => `  - ${s}`).join("\n");

  // Build skills table
  const skillsTable = invocations
    .map((inv) => {
      const ts = entries[inv.index]?.timestamp;
      const time = ts
        ? new Date(ts).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "—";
      return `| ${time} | ${inv.skill} | ${inv.args ?? "—"} |`;
    })
    .join("\n");

  // Build context section from surrounding text
  const contextText = invocations
    .map((inv) => {
      const parts: string[] = [];
      if (inv.contextBefore) parts.push(inv.contextBefore);
      if (inv.contextAfter) parts.push(inv.contextAfter);
      return parts.join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
session: "[[Sessions/${shortSessionId(sessionId)}]]"${ccVersionYaml}${modelYaml}
source: skill
skills:
${skillsYaml}
---
# ${title}

## Skills Used

| Time | Skill | Args |
|------|-------|------|
${skillsTable}

## Context

${contextText || "_No context captured_"}
`;

  const createResult = createVaultNote(activityPath, noteContent, config.vault);
  if (!createResult.success) {
    debugLog("Failed to create skill activity note\n", DEBUG_LOG);
    return null;
  }

  // Journal entry
  const journalEntry = `\\n### ${title}\\n\\n| | |\\n|---|---|\\n| [[${activityPath}\\|${ampmTime}]] | ${summary} |`;
  appendToJournal(journalEntry, journalPath, config.vault);
  mergeTagsOnDailyNote(newTags, journalPath, config.vault);

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
    model: planStats?.model,
    cc_version: ccVersion,
    planStats: planStats ?? undefined,
    source: "skill",
    skill_name: uniqueSkills.join(","),
  };

  writeVaultState(state, config.vault);
  debugLog(`Skill state built: ${title} -> ${activityPath}\n`, DEBUG_LOG);
  return { state, boundaryIdx };
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

    // Find transcript early — needed for both plan-mode and superpowers paths
    let transcriptPath = payload.transcript_path || null;
    if (!transcriptPath) {
      transcriptPath = findTranscriptPath(sessionId, payload.cwd);
    }

    // Resolve vault filesystem path (used for state cleanup and journal appends)
    const vaultPath = getVaultPath(config.vault);

    // Gate: scan vault for pending session state (also cleans up stale states)
    let state = scanForVaultState(sessionId, config);
    let boundaryIdx = -1;
    let entries: TranscriptEntry[] = [];
    let isSuperpowers = false;

    if (state) {
      debugLog(`Found state for session ${sessionId}: ${state.plan_title}\n`, DEBUG_LOG);

      if (!transcriptPath) {
        debugLog("Cannot find transcript, keeping state for retry\n", DEBUG_LOG);
        process.exit(0);
      }

      entries = parseTranscript(transcriptPath);

      if (state.source === "superpowers") {
        // State was written by a prior superpowers capture — find boundary from transcript
        isSuperpowers = true;
        const spWrites = findSuperpowersWrites(
          entries,
          config.superpowers_spec_pattern,
          config.superpowers_plan_pattern,
        );
        boundaryIdx = findSuperpowersBoundary(spWrites);
      } else if (state.source === "skill") {
        // State was written by skill capture — find boundary from skill invocations
        const skillInvocations = findSkillInvocations(entries);
        boundaryIdx = skillInvocations.length > 0 ? skillInvocations[0].index : -1;
      } else {
        boundaryIdx = findExitPlanIndex(entries);
      }

      if (boundaryIdx === -1) {
        debugLog("No plan boundary found in transcript\n", DEBUG_LOG);
        if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
        process.exit(0);
      }
    } else {
      // No state — cheap pre-check before full transcript parse
      if (!transcriptPath) process.exit(0);

      // Check for superpowers writes first
      const specPat = config.superpowers_spec_pattern || "/superpowers/specs/";
      const planPat = config.superpowers_plan_pattern || "/superpowers/plans/";
      const hasSuperpowers = transcriptContainsPattern(transcriptPath, [specPat, planPat]);
      const hasSkills = !hasSuperpowers && transcriptContainsPattern(transcriptPath, ['"Skill"']);

      if (!hasSuperpowers && !hasSkills) process.exit(0);

      entries = parseTranscript(transcriptPath);

      if (hasSuperpowers) {
        const spWrites = findSuperpowersWrites(entries, specPat, planPat);
        if (spWrites.length === 0) process.exit(0);

        isSuperpowers = true;
        debugLog(`Superpowers session detected: ${spWrites.length} spec/plan writes\n`, DEBUG_LOG);

        const result = await buildSuperpowersState(sessionId, spWrites, entries, payload, config);
        if (!result) {
          debugLog("Failed to build superpowers state\n", DEBUG_LOG);
          process.exit(0);
        }

        state = result.state;
        boundaryIdx = result.boundaryIdx;
      } else {
        // Skill detection path
        const skillInvocations = findSkillInvocations(entries);
        if (skillInvocations.length === 0) process.exit(0);

        debugLog(
          `Skill session detected: ${skillInvocations.map((s) => s.skill).join(", ")}\n`,
          DEBUG_LOG,
        );

        const result = await buildSkillState(sessionId, skillInvocations, entries, payload, config);
        if (!result) {
          debugLog("Failed to build skill state\n", DEBUG_LOG);
          process.exit(0);
        }

        state = result.state;
        boundaryIdx = result.boundaryIdx;
      }
    }

    // Check for execution activity after the planning boundary
    if (!hasExecutionAfter(entries, boundaryIdx) && state.source !== "skill") {
      debugLog("No execution tools after plan boundary, waiting for next Stop\n", DEBUG_LOG);
      if (!isSuperpowers) {
        // For plan-mode, keep state for retry. For superpowers, state is ephemeral.
        process.exit(0);
      }
      // Superpowers: still capture the plan note even without execution
      // (state was already created with vault note in buildSuperpowersState)
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
      process.exit(0);
    }

    // Collect execution stats from transcript
    const stats = collectExecutionStats(entries, boundaryIdx);

    // Collect detailed transcript stats for the execution phase
    let transcriptStats: TranscriptStats | null = null;
    try {
      transcriptStats = collectTranscriptStats(entries, boundaryIdx);
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

    const contextCap = resolveContextCap(
      transcriptStats?.peakTurnContext ?? 0,
      config.context_cap,
      sessionId,
    );
    const modelYaml = formatModelYaml(transcriptStats, contextCap);
    const ccVersion = state.cc_version ?? readCcVersion(sessionId);
    const ccVersionYaml = formatCcVersionYaml(ccVersion);

    const noteContent = `---
created: "[[${journalPath}|${datetime}]]"${project ? `\nproject: ${project}` : ""}${tagsYaml ? `\ntags:\n${tagsYaml}` : ""}
plan: "[[${state.plan_dir}/${state.source === "skill" ? "activity" : "plan"}|${state.plan_title.replace(/"/g, '\\"')}]]"
duration: "${duration}"${ccVersionYaml}${modelYaml}
---
# Done: ${state.plan_title}

## Summary

${doneText}

## Files Changed

${fileList}

---
*Duration: ${duration}*
`;

    const createResult = createVaultNote(summaryPath, noteContent, config.vault);
    if (!createResult.success) {
      debugLog("Failed to create summary note\n", DEBUG_LOG);
      if (vaultPath) deleteVaultState(state.plan_dir, vaultPath);
      process.exit(0);
    }

    // Create per-skill activity notes for mixed sessions (plan + skills)
    if (state.source !== "skill") {
      // For non-skill sessions (plan-mode, superpowers), check if skills were also used
      const skillInvocations = findSkillInvocations(entries);
      if (skillInvocations.length > 0) {
        debugLog(
          `Mixed session: ${skillInvocations.length} skill(s) detected alongside ${state.source}\n`,
          DEBUG_LOG,
        );

        for (const inv of skillInvocations) {
          const skillNotePath = `${state.plan_dir}/${inv.skill}`;
          const contextText = [inv.contextBefore, inv.contextAfter].filter(Boolean).join("\n\n");
          const skillNoteContent = `---
created: "[[${journalPath}|${datetime}]]"
plan: "[[${state.plan_dir}/plan|${state.plan_title.replace(/"/g, '\\"')}]]"
source: skill
skill: ${inv.skill}
---
# ${inv.skill}

${contextText || "_No context captured_"}
`;
          const skillResult = createVaultNote(skillNotePath, skillNoteContent, config.vault);
          if (!skillResult.success) {
            debugLog(`Failed to create skill note: ${skillNotePath}\n`, DEBUG_LOG);
          } else {
            debugLog(`Skill note captured -> ${skillNotePath}.md\n`, DEBUG_LOG);
          }
        }
      }
    }

    // Create tools-stats.md with combined stats from both phases
    const planStats = state.planStats ?? null;
    const toolsNoteContent = formatToolsNoteContent({
      planStats,
      execStats: transcriptStats,
      planTitle: state.plan_title,
      planDir: state.plan_dir,
      journalPath,
      datetime,
      project,
      contextCap,
      ccVersion,
    });

    if (toolsNoteContent) {
      const toolsNotePath = `${state.plan_dir}/tools-stats`;
      const toolsResult = createVaultNote(toolsNotePath, toolsNoteContent, config.vault);
      if (!toolsResult.success) {
        debugLog("Failed to create tools-stats note\n", DEBUG_LOG);
      } else {
        debugLog(`Tools stats captured -> ${toolsNotePath}.md\n`, DEBUG_LOG);
      }
    }

    // Create tools-log.md with chronological tool use log
    const planLog = planStats ? collectToolLog(entries, 0, boundaryIdx) : null;
    const execLog = transcriptStats ? collectToolLog(entries, boundaryIdx) : null;

    const toolsLogResult = formatToolsLogContent({
      planLog,
      execLog,
      planTitle: state.plan_title,
      planDir: state.plan_dir,
      journalPath,
      datetime,
      project,
      contextCap,
      ccVersion,
      model: transcriptStats?.model ?? planStats?.model,
    });

    if (toolsLogResult) {
      // Create agent prompt files
      for (const agentFile of toolsLogResult.agentFiles) {
        const result = createVaultNote(agentFile.path, agentFile.content, config.vault);
        if (!result.success) {
          debugLog(`Failed to create agent file: ${agentFile.path}\n`, DEBUG_LOG);
        } else {
          debugLog(`Agent prompt captured -> ${agentFile.path}.md\n`, DEBUG_LOG);
        }
      }

      // Create tools-log.md
      const toolsLogPath = `${state.plan_dir}/tools-log`;
      const logResult = createVaultNote(toolsLogPath, toolsLogResult.markdown, config.vault);
      if (!logResult.success) {
        debugLog("Failed to create tools-log note\n", DEBUG_LOG);
      } else {
        debugLog(`Tools log captured -> ${toolsLogPath}.md\n`, DEBUG_LOG);
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
