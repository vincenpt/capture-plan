# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin that captures plans and execution summaries to an Obsidian vault. Two hooks fire during a Claude Code session:

- **PostToolUse (ExitPlanMode)** → `capture-plan.ts`: Captures plan content, summarizes with Claude Haiku, writes an Obsidian note, appends to daily journal
- **Stop** → `capture-done.ts`: If a plan was captured, parses the session transcript, extracts execution results, writes a companion summary note

## Commands

```bash
bun test                              # Run all tests (422 tests across 14 files)
bun test capture-done.test.ts         # Run a single test file
bun test --grep "pattern"             # Run tests matching a pattern
bun test --watch                      # Watch mode
bun run lint                          # Lint with Biome (errors only)
bun run check                         # Lint + format check
bun run check:fix                     # Auto-fix lint + format issues
```

No build step — Bun runs TypeScript natively. Biome handles linting and formatting (`biome.json`).

## Code Standards

- **No `any` types** — use proper interfaces, `unknown`, or type-safe helpers. `noExplicitAny` is an error.
- **No non-null assertions (`!`)** — use optional chaining (`?.`), guards, or local const extraction instead.
- **JSDoc on all exports** — every exported function, type, and interface must have a `/** ... */` doc comment. Do not use `// ---- Section ----` divider comments.
- For Bun process mocks in tests, use the `spawnSyncResult()` helper in `shared.external.test.ts` instead of `as any` casts.
- Run `bun run check` before committing to catch lint + format issues.

## Architecture

### Hook Data Flow

1. `capture-plan.ts` receives the ExitPlanMode payload via stdin JSON, extracts plan content, creates an Obsidian note at `<vault>/<plan_path>/<yyyy>/<mm-dd>/<counter>-<slug>/plan.md`, and saves session state to `hooks/state/{sessionId}.json`
2. `capture-done.ts` receives the Stop payload via stdin JSON, reads saved session state, finds and parses the transcript, and writes `summary.md` in the same directory as the plan

### Key Modules: `hooks/lib/` and `hooks/shared.ts`

`hooks/shared.ts` is a barrel re-export of focused modules under `hooks/lib/`: `config.ts`, `dates.ts`, `formatting.ts`, `obsidian.ts`, `session-state.ts`, `text.ts`, `types.ts`. Hook scripts import from `./shared.ts`; tests and internal modules import from `./lib/` directly.

### Config Cascade (highest priority wins)

1. Project local: `$PROJECT/.claude/capture-plan.toml`
2. User global: `~/.config/capture-plan/config.toml`
3. Plugin default: `capture-plan.toml` (repo root)

Config is loaded via Bun's built-in TOML `import()`.

### Test Organization

Tests in `hooks/__tests__/` are split by functional suite:
- `text.test.ts` — string processing, slugs, tags (pure)
- `dates.test.ts` — date/time formatting (pure)
- `formatting-stats.test.ts` — stats YAML, context caps, plan frontmatter (pure)
- `tools-note.test.ts` — tools summary note rendering (pure)
- `tools-log.test.ts` — tools log rendering, agent files (pure)
- `transcript-parsing.test.ts` — transcript reading, plan boundary detection
- `transcript-extraction.test.ts` — extracting text, files, stats from transcripts
- `transcript-stats-unit.test.ts` — individual stat-collection functions
- `transcript-stats-integration.test.ts` — composed stats, tool usage, tool log
- `shared.filesystem.test.ts` — filesystem ops with temp directories
- `shared.external.test.ts` — mocked Obsidian CLI and Claude API calls
- `backport-journal.test.ts` — plan backporting workflow
- `capture-session-start.test.ts` — session initialization
- `skill-detection.test.ts` — skill invocation detection, pre-check patterns, mixed sessions

Shared test factories live in `helpers/transcript-helpers.ts`.

### Session State

`hooks/state/{sessionId}.json` bridges the two hooks — written by capture-plan, read by capture-done. States older than 2 hours are discarded.

### Stale TypeScript Language Server

If the LSP tool reports diagnostics about missing exports or types that clearly exist in the code (and tests pass), the TypeScript language server has stale state. Restart it:

```bash
./scripts/kill-tsserver.sh
```

This targets only tsserver processes belonging to the current Claude Code session, leaving other sessions' language servers untouched. The LSP respawns tsserver automatically on the next request.

### Debug Logs

Written to `/tmp/capture-plan-debug.log` and `/tmp/capture-done-debug.log`.

### Plugin Directory Layout

- `skills/` — Plugin-distributed skills (discovered globally when plugin is installed). Must be top-level, not inside `.claude/`.
- `.claude/commands/` — Project-local dev commands (start-dev, end-dev, release). Only visible when working in this repo.
- `.claude-plugin/` — Plugin metadata: `plugin.json`, `marketplace.json`, `hooks/hooks.json`.
