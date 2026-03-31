---
description: Enable dev mode for the capture-plan plugin. Symlinks both the plugin cache and marketplace to the local repo so edits to hooks and skills take effect immediately without releasing.
---

# Start Dev Mode

Symlink the installed plugin cache **and** marketplace directory to the local repository so that both hook and skill changes take effect immediately.

Claude Code loads plugin components from two separate paths:
- **Hooks** run from `~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}/` (via `${CLAUDE_PLUGIN_ROOT}` in hooks.json)
- **Skills** load from `~/.claude/plugins/marketplaces/kriswill/` (separate copy)

Both must be symlinked for full dev mode.

## Procedure

### 1. Get the current version

Read `package.json` in the repo root to get the `version` field. Store it as `{VERSION}`.

### 2. Check current state

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
ls -la ~/.claude/plugins/marketplaces/kriswill
```

If **both** are already symlinks, tell the user dev mode is already active and stop.

### 3. Back up and symlink the cache (hooks)

Skip this step if the cache is already a symlink.

```bash
mv ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION} \
   ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}.bak
ln -s /Users/k/src/github/kriswill/capture-plan \
      ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

### 4. Back up and symlink the marketplace (skills)

Skip this step if the marketplace is already a symlink.

```bash
mv ~/.claude/plugins/marketplaces/kriswill \
   ~/.claude/plugins/marketplaces/kriswill.bak
ln -s /Users/k/src/github/kriswill/capture-plan \
      ~/.claude/plugins/marketplaces/kriswill
```

### 5. Confirm

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
ls -la ~/.claude/plugins/marketplaces/ | grep kriswill
```

Print: "Dev mode enabled — hooks and skills now run from the local repo. Hook changes take effect on the next invocation. Skill changes require starting a new Claude Code session."
