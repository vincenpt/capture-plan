# capture-plan

> **Warning:** This project is under heavy development churn. Interfaces and features are evolving rapidly and may be unstable from version to version.

A Claude Code plugin that captures plans and execution summaries to an Obsidian vault.

## What it does

- **On ExitPlanMode**: Captures the plan content, summarizes it with Claude Haiku, creates an Obsidian note, and appends an entry to your daily journal.
- **On Stop**: If a plan was executed during the session, captures the final summary as a companion note linked to the plan.

Notes are organized as:
```
Claude/Plans/<yyyy>/<mm-dd>/<counter>-<slug>/plan.md
Claude/Plans/<yyyy>/<mm-dd>/<counter>-<slug>/summary.md
```

## Prerequisites

1. **[Bun](https://bun.sh)** runtime (v1.0+)

   ```sh
   bun --version
   ```

2. **[Obsidian CLI](https://obsidian.md)** — the `obsidian` command must be available on PATH

   ```sh
   obsidian --help    # should print "Obsidian CLI" and a list of commands
   ```

3. **An Obsidian vault** — verify yours is visible to the CLI:

   ```sh
   obsidian vaults    # should list your vault names
   ```

## Installation

### Option A: CLI (recommended)

1. Add the marketplace:

   ```sh
   claude plugin marketplace add kriswill/capture-plan
   ```

2. Install the plugin:

   ```sh
   claude plugin install capture-plan@kriswill
   ```

### Option B: Manual settings.json

1. Add both the marketplace and the enabled flag to `~/.claude/settings.json`:

   ```json
   {
     "extraKnownMarketplaces": {
       "kriswill": {
         "source": {
           "source": "github",
           "repo": "kriswill/capture-plan"
         }
       }
     },
     "enabledPlugins": {
       "capture-plan@kriswill": true
     }
   }
   ```

2. Restart Claude Code, or run `/reload-plugins` inside an active session.

### Verify

After installation, confirm the hooks are active:

- `/reload-plugins` output should include the capture-plan hooks in its count.
- Enter plan mode, write a plan, and exit. Check that a note appears under `Claude/Plans/` in your vault.
- Debug logs are written to `/tmp/capture-plan-debug.log` and `/tmp/capture-done-debug.log`.

## Configuration

The plugin ships with a default config. Override settings at any of these locations (highest priority wins):

1. **Project local**: `$PROJECT/.claude/capture-plan.toml`
2. **User global**: `~/.config/capture-plan/config.toml`
3. **Plugin default**: `capture-plan.toml` (shipped with plugin)

### Config options

```toml
# Obsidian vault name (run `obsidian vaults` to list available vaults)
vault = "Personal"

# Base path for plan notes inside the vault
plan_path = "Claude/Plans"

# Base path for journal entries inside the vault
journal_path = "Journal"

# Context window cap in tokens (auto-detected, override if needed)
# Standard: 200000, Max/Enterprise: 1000000
# context_cap = 1000000
```

The `context_cap` setting controls the context window size shown in note frontmatter (e.g., `model: claude-opus-4-6 (1M)`). By default, the plugin assumes 200K and auto-detects 1M when a single turn exceeds 200K tokens. Set this explicitly if you're on Claude Max or Enterprise and want it to always show 1M.

## Skills

These slash commands are available to all users when the plugin is installed.

### `/backport-journal`

Imports plans from `~/.claude/plans/` into the Obsidian vault, creating both plan notes and daily journal entries. Walks you through filtering (by date range, project, or specific plans), choosing between AI-generated or fast text summaries, previewing with a dry run, and confirming before import. Already-imported plans are skipped automatically.

## Developer Commands

These commands are only available when working inside the capture-plan repository. They are not distributed to end users.

### `/release [major|minor|patch]`

Bumps the version across all plugin files (`package.json`, `plugin.json`, `marketplace.json`), runs tests, commits, tags, pushes, and creates a GitHub release. Defaults to `patch` if no bump type is specified.

### `/start-dev`

Enables dev mode by symlinking the plugin cache to the local repo checkout. Hook changes take effect immediately without releasing a new version.

### `/end-dev`

Disables dev mode by removing the symlink and restoring the cached release copy.

## License

MIT
