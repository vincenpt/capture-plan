# capture-plan

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

- [Bun](https://bun.sh) runtime
- [Obsidian CLI](https://github.com/Vinzent03/obsidian-advanced-uri) (`obsidian` command available on PATH)
- An Obsidian vault

## Installation

Add to your `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "capture-plan": {
      "source": {
        "source": "github",
        "repo": "kriswill/capture-plan"
      }
    }
  },
  "enabledPlugins": {
    "capture-plan@capture-plan": true
  }
}
```

Restart Claude Code. The plugin will be installed automatically.

## Configuration

The plugin ships with a default config. Override settings at any of these locations (highest priority wins):

1. **Project local**: `$PROJECT/.claude/capture-plan.config.toml`
2. **User global**: `~/.config/capture-plan/config.toml`
3. **Plugin default**: `capture-plan.config.toml` (shipped with plugin)

### Config options

```toml
# Obsidian vault name (run `obsidian vaults` to list available vaults)
vault = "Personal"

# Base path for plan notes inside the vault
plan_path = "Claude/Plans"

# Base path for journal entries inside the vault
journal_path = "Journal"
```

## License

MIT
