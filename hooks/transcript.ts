// transcript.ts — Transcript parsing utilities for capture-done hook

import { readFileSync } from "node:fs";

// ---- Types ----

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | ContentBlock[];
}

export interface TranscriptEntry {
  type: string;
  timestamp?: string;
  isSidechain?: boolean;
  agentId?: string;
  model?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  [key: string]: unknown;
}

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
}

export interface ToolUseRecord {
  name: string;
  calls: number;
  errors: number;
}

export interface McpServerInfo {
  name: string;
  tools: string[];
  calls: number;
}

export interface TranscriptStats {
  model: string;
  durationMs: number;
  tokens: TokenUsage;
  subagentCount: number;
  tools: ToolUseRecord[];
  mcpServers: McpServerInfo[];
  totalToolCalls: number;
  totalErrors: number;
}

// ---- Constants ----

export const EXECUTION_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit", "MultiEdit"]);

// ---- Functions ----

export function getContentBlocks(entry: TranscriptEntry): ContentBlock[] {
  if (entry.type !== "assistant") return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content;
}

export function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  const raw = readFileSync(transcriptPath, "utf8");
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  return entries;
}

export function findExitPlanIndex(entries: TranscriptEntry[]): number {
  // Find the LAST ExitPlanMode tool_use (in case of multiple plans)
  let lastIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "tool_use" && block.name === "ExitPlanMode") {
        lastIdx = i;
      }
    }
  }
  return lastIdx;
}

export function hasExecutionAfter(entries: TranscriptEntry[], afterIdx: number): boolean {
  for (let i = afterIdx + 1; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "tool_use" && block.name && EXECUTION_TOOLS.has(block.name)) {
        return true;
      }
    }
  }
  return false;
}

export function extractLastAssistantText(entries: TranscriptEntry[], afterIdx: number): string {
  // Walk backwards from end, find last assistant text block
  for (let i = entries.length - 1; i > afterIdx; i--) {
    const blocks = getContentBlocks(entries[i]);
    // Collect all text blocks from this assistant message
    const texts: string[] = [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) return texts.join("\n\n");
  }
  return "";
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function collectChangedFiles(entries: TranscriptEntry[], afterIdx: number): string[] {
  const files = new Set<string>();
  for (let i = afterIdx + 1; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type !== "tool_use" || !block.name) continue;
      if (!FILE_TOOLS.has(block.name)) continue;
      const filePath = block.input?.file_path;
      if (typeof filePath === "string" && filePath) {
        files.add(filePath);
      }
    }
  }
  return [...files];
}

export function collectAllAssistantText(entries: TranscriptEntry[], afterIdx: number): string {
  const texts: string[] = [];
  for (let i = afterIdx + 1; i < entries.length; i++) {
    for (const block of getContentBlocks(entries[i])) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      }
    }
  }
  return texts.join("\n\n");
}

export interface ExecutionStats {
  filesChanged: string[];
  allAssistantText: string;
  lastAssistantText: string;
}

export function collectExecutionStats(
  entries: TranscriptEntry[],
  afterIdx: number,
): ExecutionStats {
  return {
    filesChanged: collectChangedFiles(entries, afterIdx),
    allAssistantText: collectAllAssistantText(entries, afterIdx),
    lastAssistantText: extractLastAssistantText(entries, afterIdx),
  };
}

// ---- Transcript Stats Extraction ----

function resolveRange(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): [number, number] {
  const start = startIdx ?? 0;
  const end = endIdx ?? entries.length - 1;
  return [Math.max(0, start), Math.min(entries.length - 1, end)];
}

export function getUserContentBlocks(entry: TranscriptEntry): ContentBlock[] {
  if (entry.type !== "human") return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content;
}

export function extractModel(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): string {
  const [start, end] = resolveRange(entries, startIdx, endIdx);
  for (let i = start; i <= end; i++) {
    const model = entries[i].model;
    if (typeof model === "string" && model) {
      // Strip date suffix: claude-opus-4-6-20250624 → claude-opus-4-6
      return model.replace(/-\d{8}$/, "");
    }
  }
  return "unknown";
}

export function computeDurationMs(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): number {
  const [start, end] = resolveRange(entries, startIdx, endIdx);
  const first = entries[start]?.timestamp;
  const last = entries[end]?.timestamp;
  if (!first || !last) return 0;
  const diff = new Date(last).getTime() - new Date(first).getTime();
  return Math.max(0, diff);
}

export function aggregateTokens(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): TokenUsage {
  const [start, end] = resolveRange(entries, startIdx, endIdx);
  const totals: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_create: 0 };
  for (let i = start; i <= end; i++) {
    if (entries[i].type !== "assistant") continue;
    const usage = entries[i].message?.usage;
    if (!usage) continue;
    totals.input += usage.input_tokens ?? 0;
    totals.output += usage.output_tokens ?? 0;
    totals.cache_read += usage.cache_read_input_tokens ?? 0;
    totals.cache_create += usage.cache_creation_input_tokens ?? 0;
  }
  return totals;
}

export function countSubagents(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): number {
  const [start, end] = resolveRange(entries, startIdx, endIdx);
  const agentIds = new Set<string>();
  for (let i = start; i <= end; i++) {
    const entry = entries[i];
    if (entry.isSidechain && entry.agentId) {
      agentIds.add(entry.agentId);
    }
  }
  return agentIds.size;
}

const MCP_PREFIX = "mcp__";

function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith(MCP_PREFIX)) return null;
  const rest = toolName.slice(MCP_PREFIX.length);
  const sepIdx = rest.indexOf("__");
  if (sepIdx === -1) return { server: rest, tool: rest };
  return { server: rest.slice(0, sepIdx), tool: rest };
}

export function collectToolUsage(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): {
  tools: ToolUseRecord[];
  mcpServers: McpServerInfo[];
  totalCalls: number;
  totalErrors: number;
} {
  const [start, end] = resolveRange(entries, startIdx, endIdx);

  const toolMap = new Map<string, { calls: number; errors: number }>();
  const mcpMap = new Map<string, { tools: Set<string>; calls: number }>();

  // First pass: collect tool_use blocks and their IDs per assistant entry
  // Second pass on following human entry: match tool_result errors by tool_use_id
  for (let i = start; i <= end; i++) {
    const entry = entries[i];

    // Collect tool_use from assistant entries
    if (entry.type === "assistant") {
      const pendingToolIds = new Map<string, string>(); // tool_use_id -> tool_name
      for (const block of getContentBlocks(entry)) {
        if (block.type !== "tool_use" || !block.name) continue;
        const name = block.name;
        const rec = toolMap.get(name) ?? { calls: 0, errors: 0 };
        rec.calls++;
        toolMap.set(name, rec);

        if (block.id) pendingToolIds.set(block.id, name);

        const mcp = parseMcpToolName(name);
        if (mcp) {
          const srv = mcpMap.get(mcp.server) ?? { tools: new Set<string>(), calls: 0 };
          srv.tools.add(mcp.tool);
          srv.calls++;
          mcpMap.set(mcp.server, srv);
        }
      }

      // Check the next human entry for tool_result errors
      if (i + 1 <= end && entries[i + 1].type === "human") {
        for (const block of getUserContentBlocks(entries[i + 1])) {
          if (block.type !== "tool_result" || !block.is_error) continue;
          const toolName = block.tool_use_id ? pendingToolIds.get(block.tool_use_id) : undefined;
          if (toolName) {
            const rec = toolMap.get(toolName);
            if (rec) rec.errors++;
          }
        }
      }
    }
  }

  let totalCalls = 0;
  let totalErrors = 0;
  const tools: ToolUseRecord[] = [];
  for (const [name, rec] of toolMap) {
    tools.push({ name, calls: rec.calls, errors: rec.errors });
    totalCalls += rec.calls;
    totalErrors += rec.errors;
  }
  // Sort by call count descending
  tools.sort((a, b) => b.calls - a.calls);

  const mcpServers: McpServerInfo[] = [];
  for (const [name, info] of mcpMap) {
    mcpServers.push({ name, tools: [...info.tools], calls: info.calls });
  }
  mcpServers.sort((a, b) => b.calls - a.calls);

  return { tools, mcpServers, totalCalls, totalErrors };
}

export function collectTranscriptStats(
  entries: TranscriptEntry[],
  startIdx?: number,
  endIdx?: number,
): TranscriptStats {
  const model = extractModel(entries, startIdx, endIdx);
  const durationMs = computeDurationMs(entries, startIdx, endIdx);
  const tokens = aggregateTokens(entries, startIdx, endIdx);
  const subagentCount = countSubagents(entries, startIdx, endIdx);
  const { tools, mcpServers, totalCalls, totalErrors } = collectToolUsage(
    entries,
    startIdx,
    endIdx,
  );

  return {
    model,
    durationMs,
    tokens,
    subagentCount,
    tools,
    mcpServers,
    totalToolCalls: totalCalls,
    totalErrors,
  };
}
