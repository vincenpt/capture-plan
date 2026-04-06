// session-doc.ts — Session document creation and upsert logic

import { createVaultNote, readVaultNote } from "./obsidian.ts"
import { formatEventLine, type SessionEvent } from "./session-events.ts"
import { sessionDocPath } from "./text.ts"
import type { SessionConfig } from "./types.ts"

/** A wikilink entry parsed from or destined for session document frontmatter. */
interface SessionLink {
  path: string
  title: string
}

/** Options for initially creating a session document in the vault. */
export interface CreateSessionDocOpts {
  sessionId: string
  session: SessionConfig
  vault?: string
  project?: string
  started: string
  model?: string
  ccVersion?: string
}

/** Options for creating or updating a session document in the vault. */
export interface UpsertSessionDocOpts {
  sessionId: string
  session: SessionConfig
  vault?: string
  project?: string
  plans?: SessionLink[]
  summaries?: SessionLink[]
  toolsStats?: SessionLink[]
  toolsLogs?: SessionLink[]
  activities?: SessionLink[]
  mode?: "normal" | "plan"
  events?: SessionEvent[]
}

/** Parse a YAML list of wikilinks from session document frontmatter. */
function parseWikilinks(fm: string, key: string): SessionLink[] {
  const section = fm.match(new RegExp(`^${key}:\\n((?:\\s+-\\s+.+\\n?)*)`, "m"))
  if (!section) return []
  const links: SessionLink[] = []
  for (const line of section[1].split("\n")) {
    const match = line.match(/\[\[([^|]+)\|([^\]]+)\]\]/)
    if (match) links.push({ path: match[1], title: match[2] })
  }
  return links
}

/** Merge new links into existing ones, deduplicating by path. */
function mergeLinks(existing: SessionLink[], incoming: SessionLink[]): SessionLink[] {
  const seen = new Set(existing.map((l) => l.path))
  const result = [...existing]
  for (const link of incoming) {
    if (!seen.has(link.path)) {
      result.push(link)
      seen.add(link.path)
    }
  }
  return result
}

/** Format a list of wikilinks as YAML frontmatter lines. */
function formatLinksYaml(key: string, links: SessionLink[]): string {
  if (links.length === 0) return ""
  const items = links.map((l) => `  - "[[${l.path}|${l.title.replace(/"/g, '\\"')}]]"`)
  return `${key}:\n${items.join("\n")}`
}

/** Extract the body content after the frontmatter closing `---`. */
function parseBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
  return match ? match[1] : ""
}

/** Extract existing event lines from the `## Events` section of the body. */
function parseEventLines(body: string): string[] {
  const eventsMatch = body.match(/## Events\n\n([\s\S]*)$/)
  if (!eventsMatch) return []
  return eventsMatch[1].split("\n").filter((line) => line.startsWith("- "))
}

/** Create a new session document in the vault. Does not overwrite if one already exists. Caller must check session.enabled before calling. */
export function createSessionDoc(opts: CreateSessionDocOpts): boolean {
  const docPath = sessionDocPath(opts.session.path, opts.sessionId)

  // Don't overwrite an existing doc (e.g. on session restart)
  const existing = readVaultNote(docPath, opts.vault)
  if (existing) return false

  const fmLines: string[] = []
  fmLines.push(`session_id: "${opts.sessionId}"`)
  if (opts.project) fmLines.push(`project: ${opts.project}`)
  fmLines.push(`started: "${opts.started}"`)
  if (opts.model) fmLines.push(`model: "${opts.model}"`)
  if (opts.ccVersion) fmLines.push(`cc_version: "${opts.ccVersion}"`)
  fmLines.push(`mode: normal`)

  const startEvent: SessionEvent = {
    ts: opts.started,
    type: "start",
  }

  const content = `---\n${fmLines.join("\n")}\n---\n# Session Log\n\n## Events\n\n${formatEventLine(startEvent)}\n`

  return createVaultNote(docPath, content, opts.vault).success
}

/** Create or update a session document in the vault, accumulating back-links to plans, summaries, and tool notes. Caller must check session.enabled before calling. */
export function upsertSessionDoc(opts: UpsertSessionDocOpts): boolean {
  const docPath = sessionDocPath(opts.session.path, opts.sessionId)

  // Read existing document to merge links and events
  let existingPlans: SessionLink[] = []
  let existingSummaries: SessionLink[] = []
  let existingToolsStats: SessionLink[] = []
  let existingToolsLogs: SessionLink[] = []
  let existingActivities: SessionLink[] = []
  let existingProject: string | undefined
  let existingStarted: string | undefined
  let existingModel: string | undefined
  let existingCcVersion: string | undefined
  let existingMode: string | undefined
  let existingEventLines: string[] = []

  const existing = readVaultNote(docPath, opts.vault)
  if (existing) {
    const fmMatch = existing.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const fm = fmMatch[1]
      existingPlans = parseWikilinks(fm, "plans")
      existingSummaries = parseWikilinks(fm, "summaries")
      existingToolsStats = parseWikilinks(fm, "tools_stats")
      existingToolsLogs = parseWikilinks(fm, "tools_logs")
      existingActivities = parseWikilinks(fm, "activities")
      const projMatch = fm.match(/^project:\s*(.+)/m)
      if (projMatch) existingProject = projMatch[1].trim()
      const startedMatch = fm.match(/^started:\s*"?([^"\n]+)"?/m)
      if (startedMatch) existingStarted = startedMatch[1].trim()
      const modelMatch = fm.match(/^model:\s*"?([^"\n]+)"?/m)
      if (modelMatch) existingModel = modelMatch[1].trim()
      const ccVersionMatch = fm.match(/^cc_version:\s*"?([^"\n]+)"?/m)
      if (ccVersionMatch) existingCcVersion = ccVersionMatch[1].trim()
      const modeMatch = fm.match(/^mode:\s*(\S+)/m)
      if (modeMatch) existingMode = modeMatch[1].trim()
    }

    const body = parseBody(existing)
    existingEventLines = parseEventLines(body)
  }

  // Merge incoming links with existing
  const plans = mergeLinks(existingPlans, opts.plans ?? [])
  const summaries = mergeLinks(existingSummaries, opts.summaries ?? [])
  const toolsStats = mergeLinks(existingToolsStats, opts.toolsStats ?? [])
  const toolsLogs = mergeLinks(existingToolsLogs, opts.toolsLogs ?? [])
  const activities = mergeLinks(existingActivities, opts.activities ?? [])

  const project = opts.project ?? existingProject
  const mode = opts.mode ?? existingMode ?? "normal"

  // Build frontmatter
  const fmLines: string[] = []
  fmLines.push(`session_id: "${opts.sessionId}"`)
  if (project) fmLines.push(`project: ${project}`)
  if (existingStarted) fmLines.push(`started: "${existingStarted}"`)
  if (existingModel) fmLines.push(`model: "${existingModel}"`)
  if (existingCcVersion) fmLines.push(`cc_version: "${existingCcVersion}"`)
  fmLines.push(`mode: ${mode}`)

  const linkSections = [
    formatLinksYaml("plans", plans),
    formatLinksYaml("summaries", summaries),
    formatLinksYaml("tools_stats", toolsStats),
    formatLinksYaml("tools_logs", toolsLogs),
    formatLinksYaml("activities", activities),
  ].filter(Boolean)

  if (linkSections.length > 0) {
    fmLines.push(linkSections.join("\n"))
  }

  // Merge events: existing lines + new events formatted as lines
  const newEventLines = (opts.events ?? []).map(formatEventLine)
  const allEventLines = [...existingEventLines, ...newEventLines]

  const eventsSection = allEventLines.length > 0 ? `${allEventLines.join("\n")}\n` : ""
  const content = `---\n${fmLines.join("\n")}\n---\n# Session Log\n\n## Events\n\n${eventsSection}`

  return createVaultNote(docPath, content, opts.vault).success
}
