// formatting.ts — Stats & tool-log formatting

import type { McpServerInfo, ToolLog, ToolUseRecord, TranscriptStats } from "../transcript.ts";
import { resolveContextCap } from "./config.ts";
import { formatDuration } from "./dates.ts";
import {
  computeContextPct,
  contextCapLabel,
  escapeTableCell,
  extractTitle,
  formatCcVersionYaml,
  formatNumber,
  isCodeLike,
  langFromPath,
  toSlug,
} from "./text.ts";
import type { AgentFileEntry, ToolsLogResult } from "./types.ts";

/** Render transcript stats as YAML frontmatter lines (model, duration, tokens, etc.). */
export function formatStatsYaml(stats: TranscriptStats, contextCap?: number): string {
  const lines: string[] = [];
  const cap = contextCap ?? resolveContextCap(stats.peakTurnContext);
  const capSuffix = ` (${contextCapLabel(cap)})`;
  lines.push(`model: ${stats.model}${capSuffix}`);
  lines.push(`duration: "${formatDuration(stats.durationMs)}"`);
  lines.push(`tokens_in: ${stats.tokens.input}`);
  lines.push(`tokens_out: ${stats.tokens.output}`);
  lines.push(`context_pct: ${computeContextPct(stats.tokens, cap)}`);
  lines.push(`subagents: ${stats.subagentCount}`);
  lines.push(`tools_used: ${stats.totalToolCalls}`);
  lines.push(`total_errors: ${stats.totalErrors}`);
  if (stats.mcpServers.length > 0) {
    lines.push("mcp_servers:");
    for (const srv of stats.mcpServers) {
      lines.push(`  - ${srv.name}`);
    }
  }
  return lines.join("\n");
}

/** Render model name and context percentage as YAML frontmatter lines, or empty string if no stats. */
export function formatModelYaml(stats: TranscriptStats | null, contextCap?: number): string {
  if (!stats?.model) return "";
  const cap = contextCap ?? resolveContextCap(stats.peakTurnContext);
  const capSuffix = ` (${contextCapLabel(cap)})`;
  const pct = computeContextPct(stats.tokens, cap);
  return `\nmodel: ${stats.model}${capSuffix}\ncontext_pct: ${pct}`;
}

/** Render tool usage records as a markdown table with name, call count, and error count columns. */
export function formatToolTable(tools: ToolUseRecord[]): string {
  if (tools.length === 0) return "";
  const lines: string[] = [];
  lines.push("| Tool | Calls | Errors |");
  lines.push("|------|------:|-------:|");
  for (const tool of tools) {
    lines.push(`| ${tool.name} | ${tool.calls} | ${tool.errors} |`);
  }
  return lines.join("\n");
}

/** Combine two TranscriptStats (e.g. planning + execution phases) by summing tokens, tools, and MCP servers. */
export function mergeTranscriptStats(a: TranscriptStats, b: TranscriptStats): TranscriptStats {
  // Merge tokens
  const tokens = {
    input: a.tokens.input + b.tokens.input,
    output: a.tokens.output + b.tokens.output,
    cache_read: a.tokens.cache_read + b.tokens.cache_read,
    cache_create: a.tokens.cache_create + b.tokens.cache_create,
  };

  // Merge tool records — sum calls/errors for same-named tools
  const toolMap = new Map<string, { calls: number; errors: number }>();
  for (const t of [...a.tools, ...b.tools]) {
    const existing = toolMap.get(t.name);
    if (existing) {
      existing.calls += t.calls;
      existing.errors += t.errors;
    } else {
      toolMap.set(t.name, { calls: t.calls, errors: t.errors });
    }
  }
  const tools: ToolUseRecord[] = [...toolMap.entries()]
    .map(([name, rec]) => ({ name, calls: rec.calls, errors: rec.errors }))
    .sort((x, y) => y.calls - x.calls);

  // Merge MCP servers — union tool lists, sum calls
  const mcpMap = new Map<string, { tools: Set<string>; calls: number }>();
  for (const srv of [...a.mcpServers, ...b.mcpServers]) {
    const existing = mcpMap.get(srv.name);
    if (existing) {
      for (const t of srv.tools) existing.tools.add(t);
      existing.calls += srv.calls;
    } else {
      mcpMap.set(srv.name, { tools: new Set(srv.tools), calls: srv.calls });
    }
  }
  const mcpServers: McpServerInfo[] = [...mcpMap.entries()]
    .map(([name, info]) => ({ name, tools: [...info.tools], calls: info.calls }))
    .sort((x, y) => y.calls - x.calls);

  const totalToolCalls = a.totalToolCalls + b.totalToolCalls;
  const totalErrors = a.totalErrors + b.totalErrors;
  const model = a.model !== "unknown" ? a.model : b.model;
  const durationMs = a.durationMs + b.durationMs;

  return {
    model,
    durationMs,
    tokens,
    peakTurnContext: Math.max(a.peakTurnContext, b.peakTurnContext),
    subagentCount: a.subagentCount + b.subagentCount,
    tools,
    mcpServers,
    totalToolCalls,
    totalErrors,
  };
}

/** Build the full tools-stats note (frontmatter + body) combining planning and execution phase stats. */
export function formatToolsNoteContent(opts: {
  planStats: TranscriptStats | null;
  execStats: TranscriptStats | null;
  planTitle: string;
  planDir: string;
  journalPath: string;
  datetime: string;
  project?: string;
  contextCap?: number;
  ccVersion?: string;
}): string | null {
  const { planStats, execStats, planTitle, planDir, journalPath, datetime, project, contextCap } =
    opts;
  if (!planStats && !execStats) return null;

  // Compute combined stats for frontmatter
  const combined =
    planStats && execStats
      ? mergeTranscriptStats(planStats, execStats)
      : ((planStats ?? execStats) as TranscriptStats);

  const cap = contextCap ?? resolveContextCap(combined.peakTurnContext);
  const statsYaml = formatStatsYaml(combined, cap);

  // Build body sections
  const sections: string[] = [];

  const addPhase = (heading: string, stats: TranscriptStats): void => {
    if (sections.length > 0) sections.push("");
    sections.push(`## ${heading}`);
    sections.push("");
    sections.push(
      `*${formatDuration(stats.durationMs)} — ${formatNumber(stats.totalToolCalls)} tool calls, ${stats.totalErrors} errors*`,
    );
    sections.push("");
    const table = formatToolTable(stats.tools);
    if (table) sections.push(table);
  };

  if (planStats) addPhase("Planning Phase", planStats);
  if (execStats) addPhase("Execution Phase", execStats);

  // Combined summary
  const pct = computeContextPct(combined.tokens, cap);
  sections.push("");
  sections.push("## Combined");
  sections.push("");
  sections.push(
    `**${formatNumber(combined.totalToolCalls)} tool calls** | **${formatNumber(combined.tokens.input)} in / ${formatNumber(combined.tokens.output)} out tokens** | **${combined.totalErrors} errors**`,
  );
  sections.push(
    `**Context: ${formatNumber(combined.tokens.input + combined.tokens.output)} / ${formatNumber(cap)} (${pct}%)**`,
  );

  const body = sections.join("\n");

  const ccVersionYaml = formatCcVersionYaml(opts.ccVersion);

  return `---
created: "[[${journalPath}|${datetime}]]"
plan: "[[${planDir}/plan|${planTitle.replace(/"/g, '\\"')}]]"${project ? `\nproject: ${project}` : ""}${ccVersionYaml}
${statsYaml}
---
# Session Tools: ${planTitle}

${body}
`;
}

const LARGE_CONTENT_KEYS = new Set(["old_string", "new_string"]);
const ARG_MAX_LEN = 100;
const ARG_PREVIEW_LEN = 60;

/** Format a tool invocation's arguments as a markdown table and optional code fence for the tool log. */
export function formatToolArgs(
  toolName: string,
  input: Record<string, unknown>,
  opts?: { agentPromptLink?: string; errorMark?: string; skipDescription?: boolean },
): { table: string; codeFence: string } {
  const rows: [string, string][] = [];
  let codeFence = "";

  // Resolve file_path for language detection (Write tool)
  const filePath = typeof input.file_path === "string" ? input.file_path : "";

  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;

    // Skip description for Agent when prompt link is shown (redundant)
    if (key === "description" && opts?.skipDescription) continue;

    // Bash command → code fence, outside table
    if (key === "command" && typeof val === "string") {
      codeFence = `\`\`\`sh\n${val}\n\`\`\``;
      continue;
    }

    // Write content → 5-line head in code fence
    if (key === "content" && toolName === "Write" && typeof val === "string") {
      const lines = val.split("\n");
      const lang = langFromPath(filePath);
      const head = lines.slice(0, 5).join("\n");
      const suffix = lines.length > 5 ? `\n... [truncated, ${lines.length} lines total]` : "";
      codeFence = `\`\`\`${lang}\n${head}${suffix}\n\`\`\``;
      continue;
    }

    // ctx_execute code → code fence with language
    if (
      key === "code" &&
      typeof val === "string" &&
      (toolName.includes("ctx_execute") || toolName.includes("ctx_execute_file"))
    ) {
      const lang = typeof input.language === "string" ? input.language : "";
      codeFence = `\`\`\`${lang}\n${val}\n\`\`\``;
      continue;
    }

    // Skip language key for ctx_execute (already used in code fence)
    if (
      key === "language" &&
      (toolName.includes("ctx_execute") || toolName.includes("ctx_execute_file"))
    ) {
      continue;
    }

    // ExitPlanMode plan → extract title only, skip allowedPrompts
    if (toolName === "ExitPlanMode") {
      if (key === "allowedPrompts") continue;
      if (key === "plan" && typeof val === "string") {
        rows.push([key, escapeTableCell(extractTitle(val))]);
        continue;
      }
    }

    let display: string;
    if (typeof val === "string") {
      if (LARGE_CONTENT_KEYS.has(key)) {
        display = `[${val.length} chars]`;
      } else if (key === "prompt" && toolName === "Agent") {
        // Agent prompts: link to separate file, or full text fallback
        display = opts?.agentPromptLink ?? escapeTableCell(val);
      } else if (val.length > ARG_MAX_LEN) {
        display = escapeTableCell(`${val.slice(0, ARG_PREVIEW_LEN)}… [${val.length} total]`);
      } else {
        const escaped = escapeTableCell(val);
        display = isCodeLike(key, val) ? `\`${escaped}\`` : escaped;
      }
    } else if (typeof val === "boolean" || typeof val === "number") {
      display = `\`${val}\``;
    } else {
      const json = JSON.stringify(val);
      display =
        json.length > ARG_MAX_LEN
          ? escapeTableCell(`${json.slice(0, ARG_PREVIEW_LEN)}… [${json.length} total]`)
          : escapeTableCell(json);
    }
    rows.push([key, display]);
  }

  let table = "";
  if (rows.length > 0) {
    const displayName = toolName === "Agent" ? `**${toolName}**` : toolName;
    const header = `| ${displayName}${opts?.errorMark ?? ""} | |`;
    const divider = "|---|---|";
    const body = rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n");
    table = `${header}\n${divider}\n${body}`;
  }

  return { table, codeFence };
}

function formatTimestamp(isoTs: string): string {
  try {
    const d = new Date(isoTs);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m}:${s} ${ampm}`;
  } catch {
    return isoTs;
  }
}

function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Build the full tools-log note with per-turn tool call details, extracting agent prompts into separate files. */
export function formatToolsLogContent(opts: {
  planLog: ToolLog | null;
  execLog: ToolLog | null;
  planTitle: string;
  planDir: string;
  journalPath: string;
  datetime: string;
  project?: string;
  contextCap?: number;
  ccVersion?: string;
  model?: string;
}): ToolsLogResult | null {
  const { planLog, execLog, planTitle, planDir, journalPath, datetime, project } = opts;
  if (!planLog && !execLog) return null;

  const totalCalls = (planLog?.totalToolCalls ?? 0) + (execLog?.totalToolCalls ?? 0);
  const totalErrors = (planLog?.totalErrors ?? 0) + (execLog?.totalErrors ?? 0);
  const totalTurns = (planLog?.turns.length ?? 0) + (execLog?.turns.length ?? 0);

  // Compute total duration from all turns
  const allTurns = [...(planLog?.turns ?? []), ...(execLog?.turns ?? [])];
  const totalDurationMs = allTurns.reduce((sum, t) => sum + t.durationMs, 0);
  const totalTokensIn = allTurns.reduce((sum, t) => sum + t.tokensIn, 0);
  const totalTokensOut = allTurns.reduce((sum, t) => sum + t.tokensOut, 0);

  // Frontmatter
  const fmLines: string[] = [];
  fmLines.push(`created: "[[${journalPath}|${datetime}]]"`);
  fmLines.push(`plan: "[[${planDir}/plan|${planTitle.replace(/"/g, '\\"')}]]"`);
  if (project) fmLines.push(`project: ${project}`);
  if (opts.ccVersion) fmLines.push(`cc_version: "${opts.ccVersion}"`);
  if (opts.model) fmLines.push(`model: ${opts.model}`);
  fmLines.push(`total_tool_calls: ${totalCalls}`);
  fmLines.push(`total_errors: ${totalErrors}`);
  fmLines.push(`total_turns: ${totalTurns}`);
  if (planLog) fmLines.push(`planning_calls: ${planLog.totalToolCalls}`);
  if (execLog) fmLines.push(`execution_calls: ${execLog.totalToolCalls}`);
  fmLines.push(`duration: "${formatDuration(totalDurationMs)}"`);
  fmLines.push(`tokens_in: ${totalTokensIn}`);
  fmLines.push(`tokens_out: ${totalTokensOut}`);

  // Body
  const sections: string[] = [];
  const agentFiles: AgentFileEntry[] = [];

  const renderPhase = (heading: string, log: ToolLog): void => {
    if (sections.length > 0) sections.push("\n---\n");
    sections.push(`## ${heading}\n`);

    for (const turn of log.turns) {
      const tsLabel = turn.timestamp ? formatTimestamp(turn.timestamp) : `Turn ${turn.turnNumber}`;
      const durLabel = formatTurnDuration(turn.durationMs);
      const tokLabel = `${formatNumber(turn.tokensIn)} in · ${formatNumber(turn.tokensOut)} out`;
      const sidechain = turn.isSidechain ? " 🔀" : "";
      const toolNames = [...new Set(turn.tools.map((t) => t.name))].join(", ");
      const toolLabel = toolNames ? `: ${toolNames}` : "";
      sections.push(
        `### Turn ${turn.turnNumber}${toolLabel} — ${tsLabel} (${durLabel} | ${tokLabel})${sidechain}\n`,
      );

      if (turn.isSidechain && turn.agentId) {
        sections.push(`> *Subagent: ${turn.agentId}*\n`);
      }

      if (turn.justification) {
        const justLines = turn.justification.split("\n").map((l) => `> ${l}`);
        sections.push(`${justLines.join("\n")}\n`);
      }

      for (const tool of turn.tools) {
        // Build Agent prompt link if applicable
        let agentPromptLink: string | undefined;
        let skipDescription = false;
        if (tool.name === "Agent" && typeof tool.input.prompt === "string" && tool.input.prompt) {
          const desc =
            typeof tool.input.description === "string" && tool.input.description
              ? tool.input.description
              : "agent-prompt";
          const agentType =
            typeof tool.input.subagent_type === "string" && tool.input.subagent_type
              ? tool.input.subagent_type.toLowerCase()
              : "agent";
          const titleSlug = toSlug(planTitle);
          const filePath = `${planDir}/agents/${turn.turnNumber}-${agentType}-${titleSlug}`;
          agentFiles.push({ path: filePath, content: tool.input.prompt });
          const safeDesc = desc.replace(/[|[\]]/g, "");
          agentPromptLink = `[[${filePath}\\|${safeDesc}]]`;
          skipDescription = true;
        }

        const errorMark = tool.isError ? " ❌" : undefined;
        const { table, codeFence } = formatToolArgs(tool.name, tool.input, {
          agentPromptLink,
          errorMark,
          skipDescription,
        });
        if (table) sections.push(`${table}\n`);
        if (codeFence) sections.push(`${codeFence}\n`);
      }
      sections.push("");
    }
  };

  if (planLog && planLog.turns.length > 0) renderPhase("Planning Phase", planLog);
  if (execLog && execLog.turns.length > 0) renderPhase("Execution Phase", execLog);

  const body = sections.join("\n");

  return {
    markdown: `---
${fmLines.join("\n")}
---
# Tool Log: ${planTitle}

${body}
`,
    agentFiles,
  };
}
