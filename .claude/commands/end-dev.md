---
description: Disable dev mode for the capture-plan plugin. Removes symlinks and restores the cached release copies for both hooks and skills.
---

# End Dev Mode

Remove dev-mode symlinks and restore the installed plugin cache and marketplace.

## Procedure

### 1. Get the current version

Read `package.json` in the repo root to get the `version` field. Store it as `{VERSION}`.

### 2. Check current state

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
ls -la ~/.claude/plugins/marketplaces/kriswill
```

If **neither** is a symlink, tell the user dev mode is not active and stop.

### 3. Restore the cache (hooks)

Skip this step if the cache is not a symlink.

```bash
rm ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
mv ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}.bak \
   ~/.claude/plugins/cache/kriswill/capture-plan/{VERSION}
```

If the `.bak` directory does not exist, tell the user to reinstall: `claude plugin install capture-plan@kriswill`

### 4. Restore the marketplace (skills)

Skip this step if the marketplace is not a symlink.

```bash
rm ~/.claude/plugins/marketplaces/kriswill
mv ~/.claude/plugins/marketplaces/kriswill.bak \
   ~/.claude/plugins/marketplaces/kriswill
```

If the `.bak` directory does not exist, tell the user to reinstall: `claude plugin install capture-plan@kriswill`

### 5. Confirm

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
ls -la ~/.claude/plugins/marketplaces/ | grep kriswill
```

Print: "Dev mode disabled — hooks and skills now run from the cached release copy (v{VERSION})."
