// session-events.ts — Event buffer for session document logging
// Events are buffered to a /tmp/ JSONL file and flushed to the vault on significant events.

import { appendFileSync, readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A single session event to be logged in the session document. */
export interface SessionEvent {
  /** ISO 8601 timestamp */
  ts: string
  /** Event type identifier */
  type:
    | "start"
    | "prompt"
    | "mode:plan"
    | "mode:normal"
    | "stop"
    | "agent:start"
    | "agent:stop"
    | "compact:pre"
    | "compact:post"
  /** Optional text payload (prompt text, agent description, etc.) */
  text?: string
}

/** Build the path to the event buffer JSONL file for a session. */
export function eventBufferPath(sessionId: string): string {
  return join(tmpdir(), `capture-plan-events-${sessionId}.jsonl`)
}

/** Append a single event to the session's JSONL buffer file. */
export function appendEvent(sessionId: string, event: SessionEvent): void {
  const line = JSON.stringify(event)
  appendFileSync(eventBufferPath(sessionId), `${line}\n`)
}

/** Read all buffered events without deleting the buffer file. Returns an empty array if the file does not exist. */
export function readEvents(sessionId: string): SessionEvent[] {
  const path = eventBufferPath(sessionId)
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return []
  }

  const events: SessionEvent[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed) as SessionEvent)
    } catch {
      /* skip malformed lines */
    }
  }
  return events
}

/** Read all buffered events and delete the buffer file. Returns an empty array if the file does not exist. */
export function readAndClearEvents(sessionId: string): SessionEvent[] {
  const events = readEvents(sessionId)
  if (events.length > 0) {
    try {
      unlinkSync(eventBufferPath(sessionId))
    } catch {
      /* ignore cleanup failure */
    }
  }
  return events
}

/** Format a session event as a markdown bullet line for the session document. */
export function formatEventLine(event: SessionEvent): string {
  const date = new Date(event.ts)
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  const label = eventLabel(event)
  if (event.text) {
    return `- **${time}** \`${event.type}\` — ${label}: ${event.text}`
  }
  return `- **${time}** \`${event.type}\` — ${label}`
}

/** Human-readable label for each event type. */
function eventLabel(event: SessionEvent): string {
  switch (event.type) {
    case "start":
      return "Session started"
    case "prompt":
      return "Prompt"
    case "mode:plan":
      return "Entered plan mode"
    case "mode:normal":
      return "Exited plan mode"
    case "stop":
      return "Turn completed"
    case "agent:start":
      return "Subagent launched"
    case "agent:stop":
      return "Subagent completed"
    case "compact:pre":
      return "Context compacting"
    case "compact:post":
      return "Context compacted"
  }
}

/** Truncate a string to a maximum length, appending "..." if truncated. */
export function truncatePrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}
