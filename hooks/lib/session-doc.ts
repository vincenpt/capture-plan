// session-doc.ts — Session document creation and upsert logic

import { createVaultNote, readVaultNote } from "./obsidian.ts"
import { sessionDocPath } from "./text.ts"
import type { SessionConfig } from "./types.ts"

/** A wikilink entry parsed from or destined for session document frontmatter. */
interface SessionLink {
  path: string
  title: string
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

/** Create or update a session document in the vault, accumulating back-links to plans, summaries, and tool notes. */
export function upsertSessionDoc(opts: UpsertSessionDocOpts): boolean {
  if (!opts.session.enabled) return false

  const docPath = sessionDocPath(opts.session.path, opts.sessionId)

  // Read existing document to merge links
  let existingPlans: SessionLink[] = []
  let existingSummaries: SessionLink[] = []
  let existingToolsStats: SessionLink[] = []
  let existingToolsLogs: SessionLink[] = []
  let existingActivities: SessionLink[] = []
  let existingProject: string | undefined

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
    }
  }

  // Merge incoming links with existing
  const plans = mergeLinks(existingPlans, opts.plans ?? [])
  const summaries = mergeLinks(existingSummaries, opts.summaries ?? [])
  const toolsStats = mergeLinks(existingToolsStats, opts.toolsStats ?? [])
  const toolsLogs = mergeLinks(existingToolsLogs, opts.toolsLogs ?? [])
  const activities = mergeLinks(existingActivities, opts.activities ?? [])

  const project = opts.project ?? existingProject

  // Build frontmatter
  const fmLines: string[] = []
  fmLines.push(`session_id: "${opts.sessionId}"`)
  if (project) fmLines.push(`project: ${project}`)

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

  const content = `---\n${fmLines.join("\n")}\n---\n`

  return createVaultNote(docPath, content, opts.vault).success
}
