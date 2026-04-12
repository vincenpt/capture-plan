---
description: Enable dev mode for the capture-plan plugin. Symlinks both the plugin cache and marketplace to the local repo so edits to hooks and skills take effect immediately without releasing.
---

# Start Dev Mode

Run `bun scripts/dev-mode.ts start` and report the output.

The script reads the version from `package.json` and the plugin owner/name from `.claude-plugin/plugin.json`, then symlinks both plugin paths to the local repo:
- **Hooks cache** — `~/.claude/plugins/cache/{owner}/{name}/{version}/`
- **Skills marketplace** — `~/.claude/plugins/marketplaces/{owner}/`
