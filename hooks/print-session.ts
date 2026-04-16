#!/usr/bin/env bun
// print-session.ts — Print current session stats as JSON for the /session-print skill

import { findActiveSession, findTranscriptPath, loadConfig } from "./lib/config.ts"
import { formatDuration } from "./lib/dates.ts"
import { readEvents } from "./lib/session-events.ts"
import { getProjectName, shortSessionId } from "./lib/text.ts"
import { readContextHintFull } from "./shared.ts"
import { collectTranscriptStats, parseTranscript, type TranscriptStats } from "./transcript.ts"

/** Output shape for the session-print skill. */
interface SessionPrintOutput {
  session: {
    id: string
    shortId: string
    project: string
    model: string
    ccVersion: string
    source: string
    started: string
    durationHuman: string
    contextCap: number | null
    sessionEnabled: boolean
  }
  events: {
    prompts: number
    planEntries: number
    compactions: number
    subagentLaunches: number
  }
  transcript: {
    turns: number
    tokens: {
      input: number
      output: number
      cacheRead: number
      cacheCreate: number
      total: number
    }
    peakTurnContext: number
    subagentCount: number
    tools: Array<{ name: string; calls: number; errors: number }>
    mcpServers: Array<{ name: string; tools: string[]; calls: number }>
    totalToolCalls: number
    totalErrors: number
  } | null
  error: string | null
}

/** Build transcript stats section from the JSONL transcript file. */
function buildTranscriptSection(stats: TranscriptStats): SessionPrintOutput["transcript"] {
  return {
    turns: stats.tools.reduce((sum, t) => sum + t.calls, 0) > 0 ? stats.tools.length : 0,
    tokens: {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cache_read,
      cacheCreate: stats.tokens.cache_create,
      total:
        stats.tokens.input +
        stats.tokens.output +
        stats.tokens.cache_read +
        stats.tokens.cache_create,
    },
    peakTurnContext: stats.peakTurnContext,
    subagentCount: stats.subagentCount,
    tools: stats.tools.map((t) => ({ name: t.name, calls: t.calls, errors: t.errors })),
    mcpServers: stats.mcpServers.map((s) => ({ name: s.name, tools: s.tools, calls: s.calls })),
    totalToolCalls: stats.totalToolCalls,
    totalErrors: stats.totalErrors,
  }
}

/** Emit an error result and exit. */
function emitError(error: string): never {
  console.log(
    JSON.stringify({
      session: {
        id: "",
        shortId: "",
        project: "",
        model: "",
        ccVersion: "",
        source: "",
        started: "",
        durationHuman: "0s",
        contextCap: null,
        sessionEnabled: false,
      },
      events: { prompts: 0, planEntries: 0, compactions: 0, subagentLaunches: 0 },
      transcript: null,
      error,
    }),
  )
  process.exit(0)
}

// --- Main ---

const cwd = process.env.CLAUDE_CWD
if (!cwd) emitError("CLAUDE_CWD not set")

const config = await loadConfig(cwd)

// Primary: discover session from CC's canonical session files
const ccSession = findActiveSession(cwd)
if (!ccSession) emitError("No active CC session found for this CWD")

const sessionId = ccSession.sessionId

// Secondary: read plugin-specific metadata from context hint (if available)
const hint = readContextHintFull(sessionId)

const events = readEvents(sessionId)

// Count events by type
let prompts = 0
let planEntries = 0
let compactions = 0
let subagentLaunches = 0
let startedTs = ""

for (const event of events) {
  switch (event.type) {
    case "start":
      if (!startedTs) startedTs = event.ts
      break
    case "prompt":
      prompts++
      break
    case "mode:plan":
      planEntries++
      break
    case "compact:post":
      compactions++
      break
    case "agent:start":
      subagentLaunches++
      break
  }
}

// Try to load transcript stats
let transcriptSection: SessionPrintOutput["transcript"] = null
let durationMs = 0

// Prefer transcript_path from hint (written by SessionStart), fall back to path discovery
const transcriptPath = hint?.transcript_path ?? findTranscriptPath(sessionId, cwd)
if (transcriptPath) {
  try {
    const entries = parseTranscript(transcriptPath)
    if (entries.length > 0) {
      const stats = collectTranscriptStats(entries)
      transcriptSection = buildTranscriptSection(stats)
      durationMs = stats.durationMs
    }
  } catch {
    /* transcript parse failed — degrade gracefully */
  }
}

// Fallback duration: events first, then CC session startedAt
if (durationMs === 0 && startedTs) {
  durationMs = Date.now() - new Date(startedTs).getTime()
}
if (durationMs === 0 && ccSession.startedAt) {
  durationMs = Date.now() - ccSession.startedAt
}

const project = cwd ? getProjectName(cwd, config.project_name) : ""

const output: SessionPrintOutput = {
  session: {
    id: sessionId,
    shortId: shortSessionId(sessionId),
    project,
    model: hint?.model ?? "",
    ccVersion: hint?.cc_version ?? "",
    source: hint?.source ?? ccSession.entrypoint ?? "unknown",
    started: startedTs || new Date(ccSession.startedAt).toISOString(),
    durationHuman: formatDuration(durationMs),
    contextCap: hint?.context_cap ?? null,
    sessionEnabled: hint?.session_enabled ?? false,
  },
  events: {
    prompts,
    planEntries,
    compactions,
    subagentLaunches,
  },
  transcript: transcriptSection,
  error: null,
}

console.log(JSON.stringify(output))
