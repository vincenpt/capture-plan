## About this Project

A Claude Code plugin that captures plans, tools and execution summaries to an Obsidian vault using hooks:

- PostToolUse, ExitPlanMode → `capture-plan.ts`: Captures plan content, summarizes with Claude Haiku, writes an Obsidian note, appends to daily journal
- Stop → `capture-done.ts`: Parses the session transcript, extracts execution results

## Commands

- bun test
- bun test capture-done.test.ts # Run a single test file
- bun test --grep "pattern" # Run tests matching a pattern
- bun test --watch # Watch mode
- bun check # Biome lint + format check
- bun check:fix # Auto-fix biome issues

No build step — Bun runs TypeScript natively.

## Code Standards

- No `any` types — use proper interfaces, `unknown`, or type-safe helpers. `noExplicitAny` is an error
- No non-null assertions (`!`) — use optional chaining (`?.`), guards, or local const extraction instead
- JSDoc on all exports — every exported function, type, and interface must have a `/** ... */` comment
- For Bun process mocks in tests, use the `spawnSyncResult()` helper in `shared.external.test.ts` instead of `as any` casts
- Run `bun check` before committing

## Architecture

### Hook Data Flow

1. `capture-plan.ts` receives the ExitPlanMode payload via stdin JSON, extracts plan content, creates an Obsidian note at `<vault>/<plan_path>/<yyyy>/<mm-dd>/<counter>-<slug>/plan.md`
2. `capture-done.ts` receives the Stop payload via stdin JSON, reads saved session state, finds and parses the transcript, and writes `summary.md` in the same directory

### Config Cascade (highest priority wins)

1. Project local: `$PROJECT/.claude/capture-plan.toml`
2. User global: `~/.config/capture-plan/config.toml`
3. Plugin default: `capture-plan.toml` (repo root)

### Session State

`<vault>/<plan_path>/<yyyy>/<mm-dd>/<counter>-<slug>/state.md` bridges the two hooks — written by capture-plan, read by capture-done.

### Troubleshooting

If the LSP tool reports diagnostics about missing exports or types that clearly exist in the code (and tests pass), the TypeScript language server has stale state. Restart it:

    ./scripts/kill-tsserver.sh

This targets only tsserver processes belonging to the current Claude Code process. The LSP respawns on the next request

Debug Logs are written to `/tmp/capture-[plan|done]-debug.log`

### Plugin Layout

- skills/ — Plugin-distributed skills (discovered globally when plugin is installed). Must be top-level, not inside .claude/
- .claude/commands/ — Project-local dev commands (start-dev, end-dev, release). Only visible when working in this repo
- .claude-plugin/ — Plugin metadata: plugin.json, marketplace.json, hooks/hooks.json
