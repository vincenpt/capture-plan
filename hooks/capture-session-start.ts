#!/usr/bin/env bun
// capture-session-start.ts — Claude Code SessionStart Hook
// Detects context window size and writes a hint file for downstream hooks

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugLog, loadConfig } from "./shared.ts";

const DEBUG_LOG = "/tmp/capture-plan-debug.log";

interface SessionStartPayload {
  session_id: string;
  hook_event_name?: string;
  source?: string;
  model?: string;
  cwd?: string;
  [key: string]: unknown;
}

export interface ContextHint {
  session_id: string;
  context_cap?: number;
  model?: string;
  cc_version?: string;
  source: string;
}

/** Parse context window size from a model identifier like "claude-opus-4-6[1m]". */
export function parseModelContextCap(model: string): number | undefined {
  const match = model.match(/\[(\d+)([km])\]/i);
  if (!match) return undefined;
  const num = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "m") return num * 1_000_000;
  if (unit === "k") return num * 1_000;
  return undefined;
}

/** Parse Claude Code version from `claude --version` output (e.g. "2.1.89 (Claude Code)"). */
export function parseCcVersion(raw: string): string | undefined {
  const match = raw.trim().match(/^(\d+\.\d+\.\d+)/);
  return match ? `v${match[1]}` : undefined;
}

function detectCcVersion(): string | undefined {
  try {
    const result = Bun.spawnSync(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return undefined;
    return parseCcVersion(result.stdout.toString());
  } catch {
    return undefined;
  }
}

export function contextHintPath(sessionId: string): string {
  return join(tmpdir(), `capture-plan-context-${sessionId}.json`);
}

async function main(): Promise<void> {
  try {
    const input = await Bun.stdin.text();
    debugLog(`=== SESSION START ${new Date().toISOString()} ===\n${input}\n---\n`, DEBUG_LOG);

    const payload: SessionStartPayload = JSON.parse(input);
    const sessionId = payload.session_id;
    if (!sessionId) return;

    const config = await loadConfig(payload.cwd);

    // Try to detect context cap from model identifier (e.g., "claude-opus-4-6[1m]")
    let detectedCap: number | undefined;
    if (payload.model) {
      detectedCap = parseModelContextCap(payload.model);
      debugLog(
        `SessionStart model=${payload.model} detectedCap=${detectedCap ?? "none"}\n`,
        DEBUG_LOG,
      );
    }

    // Priority: config override > model detection
    const contextCap = config.context_cap ?? detectedCap;

    const ccVersion = detectCcVersion();
    debugLog(`SessionStart cc_version=${ccVersion ?? "unknown"}\n`, DEBUG_LOG);

    const hint: ContextHint = {
      session_id: sessionId,
      context_cap: contextCap,
      model: payload.model,
      cc_version: ccVersion,
      source: payload.source ?? "unknown",
    };

    const hintFile = contextHintPath(sessionId);
    writeFileSync(hintFile, JSON.stringify(hint));
    debugLog(`Context hint written: ${hintFile} cap=${contextCap ?? "auto"}\n`, DEBUG_LOG);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog(`SessionStart error: ${msg}\n`, DEBUG_LOG);
  }
}

main();
