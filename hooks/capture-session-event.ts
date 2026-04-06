#!/usr/bin/env bun
// capture-session-event.ts — Unified handler for session lifecycle hooks
// Handles: UserPromptSubmit, EnterPlanMode, SubagentStart, SubagentStop, PreCompact, PostCompact

import { readFileSync, writeFileSync } from "node:fs"
import type { ContextHint } from "./capture-session-start.ts"
import { contextHintPath } from "./capture-session-start.ts"
import { createSessionDoc, upsertSessionDoc } from "./lib/session-doc.ts"
import { appendEvent, readAndClearEvents, truncatePrompt } from "./lib/session-events.ts"
import { debugLog, detectCcVersion, getProjectName, loadConfig } from "./shared.ts"

const DEBUG_LOG = "/tmp/capture-plan-debug.log"

/** Default prompt max chars if not configured. */
const DEFAULT_PROMPT_MAX_CHARS = 1000

interface EventPayload {
  session_id: string
  hook_event_name?: string
  tool_name?: string
  cwd?: string
  /** UserPromptSubmit provides the user's prompt text. */
  user_message?: string
  /** SubagentStart may include a description. */
  description?: string
  [key: string]: unknown
}

/** Read the cached context hint for fast session_enabled check. Returns null if unavailable. */
function readHint(sessionId: string): ContextHint | null {
  try {
    const raw = readFileSync(contextHintPath(sessionId), "utf8")
    return JSON.parse(raw) as ContextHint
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  try {
    const input = await Bun.stdin.text()
    const payload: EventPayload = JSON.parse(input)
    const sessionId = payload.session_id
    if (!sessionId) return

    // Fast-path: check cached session_enabled from context hint
    // If hint is missing (SessionStart had no stdin), bootstrap lazily
    let hint = readHint(sessionId)
    if (!hint) {
      const config = await loadConfig(payload.cwd)
      const enabled = config.session.enabled ?? false
      const ccVersion = detectCcVersion()
      hint = {
        session_id: sessionId,
        session_enabled: enabled,
        cc_version: ccVersion,
        source: "lazy-init",
      }
      writeFileSync(contextHintPath(sessionId), JSON.stringify(hint))
      debugLog(`SessionEvent: lazy-init hint for ${sessionId} enabled=${enabled}\n`, DEBUG_LOG)

      if (enabled) {
        const now = new Date().toISOString()
        const project = getProjectName(payload.cwd)
        createSessionDoc({
          sessionId,
          session: config.session,
          vault: config.vault,
          project,
          started: now,
          ccVersion,
        })
        appendEvent(sessionId, { ts: now, type: "start" })
        debugLog(`SessionEvent: lazy-init created session doc for ${sessionId}\n`, DEBUG_LOG)
      }
    }
    if (!hint.session_enabled) return

    const eventName = payload.hook_event_name ?? ""
    const toolName = payload.tool_name ?? ""
    const now = new Date().toISOString()

    debugLog(`SessionEvent: ${eventName} tool=${toolName}\n`, DEBUG_LOG)

    // Dispatch by event type
    if (eventName === "UserPromptSubmit") {
      const promptText = payload.user_message ?? ""
      if (!promptText) return

      // Load config for prompt_max_chars
      const config = await loadConfig(payload.cwd)
      const maxChars = config.session.prompt_max_chars ?? DEFAULT_PROMPT_MAX_CHARS
      const truncated = truncatePrompt(promptText, maxChars)

      appendEvent(sessionId, { ts: now, type: "prompt", text: truncated })
      return
    }

    if (eventName === "PostToolUse" && toolName === "EnterPlanMode") {
      appendEvent(sessionId, { ts: now, type: "mode:plan" })
      // Flush: mode transition is significant
      await flushToVault(sessionId, payload.cwd, "plan")
      return
    }

    if (eventName === "SubagentStart") {
      const desc = payload.description ?? ""
      appendEvent(sessionId, {
        ts: now,
        type: "agent:start",
        ...(desc ? { text: desc } : {}),
      })
      // Buffer only — no flush
      return
    }

    if (eventName === "SubagentStop") {
      appendEvent(sessionId, { ts: now, type: "agent:stop" })
      // Buffer only — no flush
      return
    }

    if (eventName === "PreCompact") {
      appendEvent(sessionId, { ts: now, type: "compact:pre" })
      // Buffer only — no flush
      return
    }

    if (eventName === "PostCompact") {
      appendEvent(sessionId, { ts: now, type: "compact:post" })
      // Flush: context pressure is significant
      await flushToVault(sessionId, payload.cwd)
      return
    }

    debugLog(`SessionEvent: unhandled event ${eventName}\n`, DEBUG_LOG)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    debugLog(`SessionEvent error: ${msg}\n`, DEBUG_LOG)
  }
}

/** Flush buffered events to the vault session document. */
async function flushToVault(
  sessionId: string,
  cwd?: string,
  mode?: "normal" | "plan",
): Promise<void> {
  const events = readAndClearEvents(sessionId)
  if (events.length === 0 && !mode) return

  const config = await loadConfig(cwd)
  upsertSessionDoc({
    sessionId,
    session: config.session,
    vault: config.vault,
    ...(mode ? { mode } : {}),
    events,
  })
}

main()
