# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin that captures plans and execution summaries to an Obsidian vault. Two hooks fire during a Claude Code session:

- **PostToolUse (ExitPlanMode)** → `capture-plan.ts`: Captures plan content, summarizes with Claude Haiku, writes an Obsidian note, appends to daily journal
- **Stop** → `capture-done.ts`: If a plan was captured, parses the session transcript, extracts execution results, writes a companion summary note

## Commands

```bash
bun test                              # Run all tests (181 tests across 5 files)
bun test capture-done.test.ts         # Run a single test file
bun test --grep "pattern"             # Run tests matching a pattern
bun test --watch                      # Watch mode
bun run lint                          # Lint with Biome (errors only)
bun run check                         # Lint + format check
bun run check:fix                     # Auto-fix lint + format issues
```

No build step — Bun runs TypeScript natively. Biome handles linting and formatting (`biome.json`).

## Architecture

### Hook Data Flow

1. `capture-plan.ts` receives the ExitPlanMode payload via stdin JSON, extracts plan content, creates an Obsidian note at `<vault>/<plan_path>/<yyyy>/<mm-dd>/<counter>-<slug>/plan.md`, and saves session state to `hooks/state/{sessionId}.json`
2. `capture-done.ts` receives the Stop payload via stdin JSON, reads saved session state, finds and parses the transcript, and writes `summary.md` in the same directory as the plan

### Key Module: `hooks/shared.ts`

Central utility module exporting: config loading (3-layer TOML merge), Obsidian CLI wrapper, Claude Haiku summarization, date/slug helpers, session state read/write, journal append with tag merging.

### Config Cascade (highest priority wins)

1. Project local: `$PROJECT/.claude/capture-plan.toml`
2. User global: `~/.config/capture-plan/config.toml`
3. Plugin default: `capture-plan.toml` (repo root)

Config is loaded via Bun's built-in TOML `import()`.

### Test Organization

Tests in `hooks/__tests__/` are split by I/O boundary:
- `shared.pure.test.ts` — pure functions, no I/O
- `shared.filesystem.test.ts` — filesystem ops with temp directories
- `shared.external.test.ts` — mocked Obsidian CLI and Claude API calls
- `capture-done.test.ts` — integration tests for the Stop hook

### Session State

`hooks/state/{sessionId}.json` bridges the two hooks — written by capture-plan, read by capture-done. States older than 2 hours are discarded.

### Debug Logs

Written to `/tmp/capture-plan-debug.log` and `/tmp/capture-done-debug.log`.
