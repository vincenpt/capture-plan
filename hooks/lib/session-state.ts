// session-state.ts — Session state persistence and plan frontmatter parsing

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptStats } from "../transcript.ts";
import { formatDatePath, getDatePartsFor } from "./dates.ts";
import { createVaultNote, getVaultPath, runObsidian } from "./obsidian.ts";
import { ensureMdExt } from "./text.ts";
import type { Config, PlanFrontmatter, SessionState } from "./types.ts";

const STALE_STATE_MS = 2 * 60 * 60 * 1000; // 2 hours

function serializeStateToFrontmatter(state: SessionState): string {
  const lines: string[] = ["---"];
  lines.push(`session_id: "${state.session_id}"`);
  lines.push(`plan_slug: "${state.plan_slug}"`);
  lines.push(`plan_title: "${state.plan_title.replace(/"/g, '\\"')}"`);
  lines.push(`plan_dir: "${state.plan_dir}"`);
  lines.push(`date_key: "${state.date_key}"`);
  lines.push(`timestamp: "${state.timestamp}"`);
  if (state.journal_path) lines.push(`journal_path: "${state.journal_path}"`);
  if (state.project) lines.push(`project: "${state.project}"`);
  if (state.tags) lines.push(`tags: "${state.tags}"`);
  if (state.model) lines.push(`model: "${state.model}"`);
  if (state.cc_version) lines.push(`cc_version: "${state.cc_version}"`);
  if (state.source) lines.push(`source: "${state.source}"`);
  if (state.spec_path) lines.push(`spec_path: "${state.spec_path}"`);
  if (state.skill_name) lines.push(`skill_name: "${state.skill_name}"`);
  if (state.planStats) {
    const json = JSON.stringify(state.planStats).replace(/"/g, '\\"');
    lines.push(`plan_stats_json: "${json}"`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Parse a SessionState from the YAML frontmatter of a vault state note. Returns null if missing or malformed. */
export function parseStateFromFrontmatter(content: string): SessionState | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  const get = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*"(.*)"\\s*$`, "m"));
    return m ? m[1] : undefined;
  };

  const sessionId = get("session_id");
  const planSlug = get("plan_slug");
  const planTitle = get("plan_title");
  const planDir = get("plan_dir");
  const dateKey = get("date_key");
  const timestamp = get("timestamp");
  if (!sessionId || !planSlug || !planTitle || !planDir || !dateKey || !timestamp) return null;

  const state: SessionState = {
    session_id: sessionId,
    plan_slug: planSlug,
    plan_title: planTitle.replace(/\\"/g, '"'),
    plan_dir: planDir,
    date_key: dateKey,
    timestamp,
    journal_path: get("journal_path"),
    project: get("project"),
    tags: get("tags"),
    model: get("model"),
    cc_version: get("cc_version"),
    source: get("source") as SessionState["source"],
    spec_path: get("spec_path"),
    skill_name: get("skill_name"),
  };

  const statsJson = get("plan_stats_json");
  if (statsJson) {
    try {
      state.planStats = JSON.parse(statsJson.replace(/\\"/g, '"')) as TranscriptStats;
    } catch {
      /* ignore malformed stats */
    }
  }

  return state;
}

/** Persist session state as a frontmatter-only vault note for the Stop hook to discover. */
export function writeVaultState(state: SessionState, vault?: string): boolean {
  const content = serializeStateToFrontmatter(state);
  return createVaultNote(`${state.plan_dir}/state`, content, vault).success;
}

/** Scan today's and yesterday's plan directories for a matching session state file, cleaning up stale entries. */
export function scanForVaultState(sessionId: string, config: Config): SessionState | null {
  const vaultPath = getVaultPath(config.vault);
  if (!vaultPath) return null;

  const planRoot = join(vaultPath, config.plan.path);
  let match: SessionState | null = null;

  // State files expire in 2h, so only scan today + yesterday (covers midnight crossover)
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const recentDatePaths = [today, yesterday].map((d) => {
    const parts = getDatePartsFor(d);
    return formatDatePath(config.plan.date_scheme, parts);
  });

  for (const dateSeg of recentDatePaths) {
    const datePath = join(planRoot, dateSeg);
    try {
      for (const planDir of readdirSync(datePath, { withFileTypes: true })) {
        if (!planDir.isDirectory()) continue;
        const stateFile = join(datePath, planDir.name, "state.md");
        try {
          const text = readFileSync(stateFile, "utf8");
          if (!text) continue;
          const state = parseStateFromFrontmatter(text);
          if (!state) continue;

          // Housekeeping: remove stale state files
          const age = Date.now() - new Date(state.timestamp).getTime();
          if (age > STALE_STATE_MS) {
            const vaultRelative = `${config.plan.path}/${dateSeg}/${planDir.name}/state.md`;
            runObsidian(["delete", `path=${vaultRelative}`, "permanent"], config.vault);
            continue;
          }

          if (state.session_id === sessionId) {
            match = state;
          }
        } catch {
          /* file doesn't exist or unreadable — skip */
        }
      }
    } catch {
      /* date directory doesn't exist — skip */
    }
  }

  return match;
}

/** Remove the state.md file from a plan directory after the Stop hook has consumed it. */
export function deleteVaultState(planDir: string, vault?: string): void {
  runObsidian(["delete", `path=${planDir}/state.md`, "permanent"], vault);
}

/** Extract structured fields (created, tags, counter, etc.) from a plan note's YAML frontmatter. */
export function parsePlanFrontmatter(content: string): PlanFrontmatter {
  const result: PlanFrontmatter = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return result;
  const fm = fmMatch[1];

  // created: "[[Journal/path|datetime]]"
  const createdMatch = fm.match(/^created:\s*"?\[\[([^|]+)\|([^\]]+)\]\]"?/m);
  if (createdMatch) {
    result.created = `[[${createdMatch[1]}|${createdMatch[2]}]]`;
    result.journalPath = createdMatch[1];
    result.datetime = createdMatch[2];
  }

  // status
  const statusMatch = fm.match(/^status:\s*(.+)/m);
  if (statusMatch) result.status = statusMatch[1].trim();

  // counter
  const counterMatch = fm.match(/^counter:\s*(\d+)/m);
  if (counterMatch) result.counter = parseInt(counterMatch[1], 10);

  // session
  const sessionMatch = fm.match(/^session:\s*(.+)/m);
  if (sessionMatch) result.session = sessionMatch[1].trim();

  // project
  const projectMatch = fm.match(/^project:\s*(.+)/m);
  if (projectMatch) result.project = projectMatch[1].trim();

  // source_slug (for backport dedup)
  const sourceSlugMatch = fm.match(/^source_slug:\s*(.+)/m);
  if (sourceSlugMatch) result.source_slug = sourceSlugMatch[1].trim();

  // tags (YAML list format)
  const tagsSection = fm.match(/^tags:\n((?:\s+-\s+.+\n?)*)/m);
  if (tagsSection) {
    result.tags = tagsSection[1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }

  return result;
}

/** Append a revision bullet to an existing callout block with the given title in the journal file.
 *  Reads the file directly (safe for vault index), but writes back via Obsidian CLI to keep the vault in sync. */
export async function appendRevisionToCallout(
  planTitle: string,
  revision: string,
  journalFilePath: string,
  journalRelPath: string,
  vault?: string,
): Promise<boolean> {
  try {
    const content = await Bun.file(journalFilePath).text();
    const lines = content.split("\n");

    // Find > [!plan]+ {title} header
    const headerPattern = `> [!plan]+ ${planTitle}`;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === headerPattern) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) return false;

    // Find the last line starting with ">" in this callout block
    let lastCalloutLine = headerIdx;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (!lines[i].startsWith(">")) break;
      lastCalloutLine = i;
    }

    // Insert the new revision lines after the last callout line
    const revisionLines = revision.split("\n");
    lines.splice(lastCalloutLine + 1, 0, ...revisionLines);

    // Write back via Obsidian CLI (createVaultNote handles delete-before-create)
    createVaultNote(ensureMdExt(journalRelPath), lines.join("\n"), vault);
    return true;
  } catch {
    return false;
  }
}
